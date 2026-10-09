import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { PROCESS_FITNESS_FILE_JOB_NAME } from '@/lib/jobs/names'
import { processFitnessFileJob } from '@/lib/jobs/processFitnessFileJob'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

import {
  createProcessFileHelpers,
  defaultActivityData,
  mockParseFitnessFile,
  resetProcessMocks
} from './processFitnessFileJob.testUtils'

vi.mock('@/lib/services/queue', async () => ({
  getQueue: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined)
  })
}))

vi.mock('@/lib/services/fitness-files', async () => {
  const actual = await vi.importActual('@/lib/services/fitness-files')
  return {
    ...actual,
    getFitnessFileBuffer: vi.fn()
  }
})

vi.mock('@/lib/services/fitness-files/parseFitnessFile', async () => ({
  parseFitnessFile: vi.fn(),
  isParseableFitnessFileType: vi.fn().mockReturnValue(true)
}))

vi.mock('@/lib/services/fitness-files/generateMapImage', async () => ({
  generateMapImage: vi.fn()
}))

vi.mock('@/lib/services/medias', async () => ({
  saveMedia: vi.fn(),
  saveMediaImageRendition: vi.fn(),
  deleteMediaFile: vi.fn()
}))

const mockSendNotificationAlerts = vi.fn()
vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts: (...args: unknown[]) =>
    mockSendNotificationAlerts(...args)
}))

vi.mock('@/lib/services/altText/openai', () => ({
  generateRouteAltText: vi.fn()
}))

describe('processFitnessFileJob', () => {
  const database = getTestSQLDatabase()
  let actor: Actor

  const { createStatusWithFitnessFile } = createProcessFileHelpers(
    database,
    () => actor
  )

  beforeAll(async () => {
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(() => {
    resetProcessMocks()
  })

  describe('gear auto-assignment', () => {
    // Gear rows outlive a test, and `findFitnessGearByDefaultSport` matches the
    // first gear holding the sport — so a bike left behind by an earlier case
    // would decide a later one. Wipe the shed between tests.
    const clearGear = async () => {
      const gears = await database.getFitnessGearsByActor({ actorId: actor.id })
      for (const gear of gears) {
        await database.deleteFitnessGear({ id: gear.id, actorId: actor.id })
      }
    }

    beforeEach(clearGear)
    afterAll(clearGear)

    it('fires the service reminder for the very activity that crosses the threshold', async () => {
      // The parsed fixture is a 5.2 km run, and the shoes are set to remind at
      // 5 km — so the crossing is caused by THIS activity and nothing else.
      //
      // This is the regression guard for evaluating reminders too early: the
      // rollups only count `completed` activities, so while the job still has
      // the file marked `processing` the total reads 0 and no reminder fires.
      // The bug is invisible in isolation — the reminder simply arrives one
      // activity late, or never, if this was the last ride on that gear.
      const shoes = await database.createFitnessGear({
        actorId: actor.id,
        kind: 'shoes',
        name: 'Reminder shoes',
        defaultSports: ['run'],
        alertDistanceMeters: 5_000
      })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      await processFitnessFileJob(database, {
        id: 'job-gear-reminder',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const reloaded = await database.getFitnessGear({
        id: shoes.id,
        actorId: actor.id
      })
      // Recorded at the distance the crossing was detected at, which must
      // include this run rather than the 0 km that precedes it.
      expect(reloaded?.lastAlertedDistanceMeters).toBe(5_200)
    })

    it('keeps a finished activity completed when the reminder lookup fails', async () => {
      // The reminder block runs AFTER the activity is written `completed`, so
      // an uncontained failure there would fall through to the job's failure
      // handler and demote a fully processed activity — hiding it from the
      // dashboard, the overview, every rollup and federation, over a read that
      // only decides whether to send a courtesy email.
      await database.createFitnessGear({
        actorId: actor.id,
        kind: 'shoes',
        name: 'Reminder lookup failure shoes',
        defaultSports: ['run'],
        alertDistanceMeters: 5_000
      })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      // Let the wrapper and core file reads through, then fail only the
      // post-completion read used for gear reminders.
      const realGetFitnessFile = database.getFitnessFile.bind(database)
      let calls = 0
      const spy = vi
        .spyOn(database, 'getFitnessFile')
        .mockImplementation(async (params) => {
          calls += 1
          if (calls > 2) throw new Error('connection reset')
          return realGetFitnessFile(params)
        })

      try {
        await processFitnessFileJob(database, {
          id: 'job-gear-reminder-read-failed',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: { actorId: actor.id, statusId, fitnessFileId }
        })
      } finally {
        spy.mockRestore()
      }

      const reloaded = await database.getFitnessFile({ id: fitnessFileId })
      expect(reloaded?.processingStatus).toBe('completed')
    })

    it('does not fire a reminder while the gear is below its threshold', async () => {
      const shoes = await database.createFitnessGear({
        actorId: actor.id,
        kind: 'shoes',
        name: 'Under threshold shoes',
        defaultSports: ['run'],
        alertDistanceMeters: 500_000
      })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      await processFitnessFileJob(database, {
        id: 'job-gear-reminder-under',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const reloaded = await database.getFitnessGear({
        id: shoes.id,
        actorId: actor.id
      })
      expect(reloaded?.lastAlertedDistanceMeters).toBeUndefined()
    })

    describe('recording device', () => {
      it('creates the device row and links the activity to it', async () => {
        mockParseFitnessFile.mockResolvedValue({
          ...defaultActivityData,
          deviceName: 'Garmin Forerunner 265',
          deviceManufacturer: 'garmin'
        })
        const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
          text: 'Morning run'
        })

        await processFitnessFileJob(database, {
          id: 'job-device-link',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: { actorId: actor.id, statusId, fitnessFileId }
        })

        const updated = await database.getFitnessFile({ id: fitnessFileId })
        expect(updated?.deviceGearId).toBeDefined()

        const device = await database.getFitnessGear({
          id: updated?.deviceGearId as string,
          actorId: actor.id
        })
        expect(device).toMatchObject({
          kind: 'device',
          name: 'Garmin Forerunner 265',
          brand: 'Garmin',
          model: 'Forerunner 265',
          deviceKey: 'name:garmin forerunner 265',
          productUrl: 'https://www.garmin.com'
        })
      })

      it('reuses one row across activities and converges on a re-run', async () => {
        mockParseFitnessFile.mockResolvedValue({
          ...defaultActivityData,
          deviceName: 'Wahoo ELEMNT BOLT'
        })
        const first = await createStatusWithFitnessFile({ text: 'Ride one' })
        const second = await createStatusWithFitnessFile({ text: 'Ride two' })

        for (const [index, file] of [first, second].entries()) {
          await processFitnessFileJob(database, {
            id: `job-device-shared-${index}`,
            name: PROCESS_FITNESS_FILE_JOB_NAME,
            data: {
              actorId: actor.id,
              statusId: file.statusId,
              fitnessFileId: file.fitnessFileId
            }
          })
        }
        // Jobs re-run; the second pass must land on the same row rather than
        // forking a duplicate.
        await processFitnessFileJob(database, {
          id: 'job-device-shared-rerun',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: {
            actorId: actor.id,
            statusId: first.statusId,
            fitnessFileId: first.fitnessFileId
          }
        })

        const firstFile = await database.getFitnessFile({
          id: first.fitnessFileId
        })
        const secondFile = await database.getFitnessFile({
          id: second.fitnessFileId
        })
        expect(firstFile?.deviceGearId).toBeDefined()
        expect(secondFile?.deviceGearId).toBe(firstFile?.deviceGearId)

        const devices = (
          await database.getFitnessGearsByActor({ actorId: actor.id })
        ).filter((gear) => gear.kind === 'device')
        expect(devices).toHaveLength(1)
      })

      it('links nothing when the file carries no device', async () => {
        const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
          text: 'Morning run'
        })

        await processFitnessFileJob(database, {
          id: 'job-device-none',
          name: PROCESS_FITNESS_FILE_JOB_NAME,
          data: { actorId: actor.id, statusId, fitnessFileId }
        })

        const updated = await database.getFitnessFile({ id: fitnessFileId })
        expect(updated?.deviceGearId).toBeUndefined()
        expect(
          (await database.getFitnessGearsByActor({ actorId: actor.id })).filter(
            (gear) => gear.kind === 'device'
          )
        ).toHaveLength(0)
      })

      it('keeps the activity completed when resolving the device fails', async () => {
        // The link is metadata on an activity that has already parsed and
        // stored. A failure here must never demote it to `failed`, which would
        // hide a perfectly good ride from every surface.
        mockParseFitnessFile.mockResolvedValue({
          ...defaultActivityData,
          deviceName: 'Garmin Edge 840',
          deviceManufacturer: 'garmin'
        })
        const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
          text: 'Morning ride'
        })

        const spy = vi
          .spyOn(database, 'findFitnessGearByDeviceKey')
          .mockRejectedValue(new Error('connection reset'))

        try {
          await processFitnessFileJob(database, {
            id: 'job-device-failure',
            name: PROCESS_FITNESS_FILE_JOB_NAME,
            data: { actorId: actor.id, statusId, fitnessFileId }
          })
        } finally {
          spy.mockRestore()
        }

        const updated = await database.getFitnessFile({ id: fitnessFileId })
        expect(updated?.processingStatus).toBe('completed')
        expect(updated?.deviceGearId).toBeUndefined()
      })
    })

    it('assigns the gear whose default sport matches the parsed activity', async () => {
      const gear = await database.createFitnessGear({
        actorId: actor.id,
        kind: 'shoes',
        name: 'Nimbus 25',
        defaultSports: ['run']
      })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      await processFitnessFileJob(database, {
        id: 'job-gear-assign',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const updatedFitnessFile = await database.getFitnessFile({
        id: fitnessFileId
      })
      expect(updatedFitnessFile?.gearId).toBe(gear.id)
    })

    it('never clobbers a gear the file already carries', async () => {
      const assignedGear = await database.createFitnessGear({
        actorId: actor.id,
        kind: 'shoes',
        name: 'Race shoes'
      })
      const defaultGear = await database.createFitnessGear({
        actorId: actor.id,
        kind: 'shoes',
        name: 'Nimbus 25',
        defaultSports: ['run']
      })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })
      await database.setFitnessFileGear({
        fitnessFileId,
        actorId: actor.id,
        gearId: assignedGear.id
      })

      await processFitnessFileJob(database, {
        id: 'job-gear-keep',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const updatedFitnessFile = await database.getFitnessFile({
        id: fitnessFileId
      })
      expect(updatedFitnessFile?.gearId).toBe(assignedGear.id)
      expect(updatedFitnessFile?.gearId).not.toBe(defaultGear.id)
    })

    it('leaves the file unattributed when no gear claims the sport', async () => {
      await database.createFitnessGear({
        actorId: actor.id,
        kind: 'bike',
        name: 'Moots',
        defaultSports: ['ride']
      })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      await processFitnessFileJob(database, {
        id: 'job-gear-no-match',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const updatedFitnessFile = await database.getFitnessFile({
        id: fitnessFileId
      })
      expect(updatedFitnessFile?.gearId).toBeUndefined()
    })

    it('skips retired gear even when it still holds the default sport', async () => {
      const gear = await database.createFitnessGear({
        actorId: actor.id,
        kind: 'shoes',
        name: 'Worn out',
        defaultSports: ['run']
      })
      await database.setFitnessGearRetired({
        id: gear.id,
        actorId: actor.id,
        retired: true
      })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Morning run'
      })

      await processFitnessFileJob(database, {
        id: 'job-gear-retired',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const updatedFitnessFile = await database.getFitnessFile({
        id: fitnessFileId
      })
      expect(updatedFitnessFile?.gearId).toBeUndefined()
    })

    it('leaves the file unattributed when the activity type maps to no sport', async () => {
      await database.createFitnessGear({
        actorId: actor.id,
        kind: 'shoes',
        name: 'Nimbus 25',
        defaultSports: ['run']
      })
      mockParseFitnessFile.mockResolvedValue({
        ...defaultActivityData,
        activityType: 'lap_swimming'
      })
      const { statusId, fitnessFileId } = await createStatusWithFitnessFile({
        text: 'Pool session'
      })

      await processFitnessFileJob(database, {
        id: 'job-gear-unknown-sport',
        name: PROCESS_FITNESS_FILE_JOB_NAME,
        data: { actorId: actor.id, statusId, fitnessFileId }
      })

      const updatedFitnessFile = await database.getFitnessFile({
        id: fitnessFileId
      })
      expect(updatedFitnessFile?.gearId).toBeUndefined()
    })
  })
})
