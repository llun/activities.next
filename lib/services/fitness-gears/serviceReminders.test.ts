import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { evaluateGearServiceReminders } from '@/lib/services/fitness-gears/serviceReminders'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

const createNotificationWithPolicy = vi.hoisted(() => vi.fn())
const sendNotificationAlerts = vi.hoisted(() => vi.fn())

vi.mock('@/lib/services/notifications/createNotificationWithPolicy', () => ({
  createNotificationWithPolicy
}))
vi.mock('@/lib/services/notifications/sendNotificationAlerts', () => ({
  sendNotificationAlerts
}))

describe('evaluateGearServiceReminders', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    createNotificationWithPolicy.mockResolvedValue({
      id: 'notification-1',
      filtered: false
    })
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database)
    })

    afterAll(async () => {
      await database.destroy()
    })

    // Attributes a completed activity of `distanceMeters` to `gearId`.
    const addRide = async (
      db: Database,
      actorId: string,
      gearId: string,
      suffix: string,
      distanceMeters: number
    ) => {
      const file = await db.createFitnessFile({
        actorId,
        path: `fitness/reminder-${suffix}.fit`,
        fileName: `reminder-${suffix}.fit`,
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024
      })
      await db.updateFitnessFileActivityData(file!.id, {
        activityType: 'cycling',
        activityStartTime: new Date('2026-05-01T08:00:00.000Z'),
        totalDistanceMeters: distanceMeters
      })
      await db.updateFitnessFileProcessingStatus(file!.id, 'completed')
      await db.assignFitnessFileGearIfUnset({
        fitnessFileId: file!.id,
        actorId,
        gearId
      })
      return file!
    }

    it('notifies once when shoes pass their distance alert', async () => {
      const shoes = await database.createFitnessGear({
        actorId: actors.primary.id,
        kind: 'shoes',
        name: 'Alerting shoes',
        alertDistanceMeters: 100_000
      })
      await addRide(
        database,
        actors.primary.id,
        shoes.id,
        'shoes-over',
        120_000
      )

      await evaluateGearServiceReminders({
        database,
        actorId: actors.primary.id,
        gearIds: [shoes.id]
      })
      expect(createNotificationWithPolicy).toHaveBeenCalledTimes(1)
      expect(createNotificationWithPolicy).toHaveBeenCalledWith(
        database,
        expect.objectContaining({
          actorId: actors.primary.id,
          type: 'gear_service_due',
          sourceActorId: actors.primary.id
        })
      )
      expect(sendNotificationAlerts).toHaveBeenCalledTimes(1)

      // A second evaluation after another ride must stay quiet.
      await addRide(database, actors.primary.id, shoes.id, 'shoes-more', 10_000)
      await evaluateGearServiceReminders({
        database,
        actorId: actors.primary.id,
        gearIds: [shoes.id]
      })
      expect(createNotificationWithPolicy).toHaveBeenCalledTimes(1)
    })

    it('stays quiet below the threshold', async () => {
      const shoes = await database.createFitnessGear({
        actorId: actors.replyAuthor.id,
        kind: 'shoes',
        name: 'Under threshold shoes',
        alertDistanceMeters: 500_000
      })
      await addRide(database, actors.replyAuthor.id, shoes.id, 'under', 100_000)

      await evaluateGearServiceReminders({
        database,
        actorId: actors.replyAuthor.id,
        gearIds: [shoes.id]
      })
      expect(createNotificationWithPolicy).not.toHaveBeenCalled()
    })

    it('re-arms when the owner raises the threshold', async () => {
      const shoes = await database.createFitnessGear({
        actorId: actors.pollAuthor.id,
        kind: 'shoes',
        name: 'Raised threshold shoes',
        alertDistanceMeters: 100_000
      })
      await addRide(database, actors.pollAuthor.id, shoes.id, 'raise', 150_000)

      await evaluateGearServiceReminders({
        database,
        actorId: actors.pollAuthor.id,
        gearIds: [shoes.id]
      })
      expect(createNotificationWithPolicy).toHaveBeenCalledTimes(1)

      await database.updateFitnessGear({
        id: shoes.id,
        actorId: actors.pollAuthor.id,
        alertDistanceMeters: 120_000
      })
      await evaluateGearServiceReminders({
        database,
        actorId: actors.pollAuthor.id,
        gearIds: [shoes.id]
      })
      expect(createNotificationWithPolicy).toHaveBeenCalledTimes(2)
    })

    it('notifies for a component that passes its service interval', async () => {
      const bike = await database.createFitnessGear({
        actorId: actors.extra.id,
        kind: 'bike',
        name: 'Component reminder bike'
      })
      const chain = await database.createFitnessGearComponent({
        gearId: bike.id,
        actorId: actors.extra.id,
        componentType: 'Chain',
        serviceDistanceMeters: 50_000
      })
      await addRide(database, actors.extra.id, bike.id, 'chain', 60_000)

      await evaluateGearServiceReminders({
        database,
        actorId: actors.extra.id,
        gearIds: [bike.id]
      })
      expect(createNotificationWithPolicy).toHaveBeenCalledTimes(1)

      const components = await database.getFitnessGearComponents({
        gearId: bike.id,
        actorId: actors.extra.id
      })
      const reloaded = components.find((item) => item.id === chain!.id)
      expect(reloaded?.lastAlertedDistanceMeters).toBe(60_000)
    })

    it('ignores a component that has already been replaced', async () => {
      const bike = await database.createFitnessGear({
        actorId: actors.followRequester.id,
        kind: 'bike',
        name: 'Replaced component bike'
      })
      const chain = await database.createFitnessGearComponent({
        gearId: bike.id,
        actorId: actors.followRequester.id,
        componentType: 'Chain',
        serviceDistanceMeters: 10_000
      })
      await addRide(
        database,
        actors.followRequester.id,
        bike.id,
        'replaced',
        50_000
      )
      await database.replaceFitnessGearComponent({
        id: chain!.id,
        gearId: bike.id,
        actorId: actors.followRequester.id
      })

      await evaluateGearServiceReminders({
        database,
        actorId: actors.followRequester.id,
        gearIds: [bike.id]
      })
      // The fresh chain starts at 0 km within its own install window, and the
      // old one is history — neither is due.
      expect(createNotificationWithPolicy).not.toHaveBeenCalled()
    })

    it('skips retired gear', async () => {
      const shoes = await database.createFitnessGear({
        actorId: actors.empty.id,
        kind: 'shoes',
        name: 'Retired alerting shoes',
        alertDistanceMeters: 10_000
      })
      await addRide(database, actors.empty.id, shoes.id, 'retired', 90_000)
      await database.setFitnessGearRetired({
        id: shoes.id,
        actorId: actors.empty.id,
        retired: true
      })

      await evaluateGearServiceReminders({
        database,
        actorId: actors.empty.id,
        gearIds: [shoes.id]
      })
      expect(createNotificationWithPolicy).not.toHaveBeenCalled()
    })

    it('does nothing for gear with no threshold set', async () => {
      const bike = await database.createFitnessGear({
        actorId: actors.empty.id,
        kind: 'bike',
        name: 'No threshold bike'
      })
      await addRide(database, actors.empty.id, bike.id, 'nothreshold', 900_000)

      await evaluateGearServiceReminders({
        database,
        actorId: actors.empty.id,
        gearIds: [bike.id]
      })
      expect(createNotificationWithPolicy).not.toHaveBeenCalled()
    })

    it('ignores another actor’s gear id', async () => {
      const shoes = await database.createFitnessGear({
        actorId: actors.primary.id,
        kind: 'shoes',
        name: 'Foreign reminder shoes',
        alertDistanceMeters: 1_000
      })
      await addRide(database, actors.primary.id, shoes.id, 'foreign', 90_000)

      await evaluateGearServiceReminders({
        database,
        actorId: actors.replyAuthor.id,
        gearIds: [shoes.id]
      })
      expect(createNotificationWithPolicy).not.toHaveBeenCalled()
    })

    it('does nothing when given no gear', async () => {
      await evaluateGearServiceReminders({
        database,
        actorId: actors.primary.id,
        gearIds: []
      })
      expect(createNotificationWithPolicy).not.toHaveBeenCalled()
    })

    it('never throws when notification creation fails', async () => {
      createNotificationWithPolicy.mockRejectedValueOnce(
        new Error('notification backend down')
      )
      const shoes = await database.createFitnessGear({
        actorId: actors.extra.id,
        kind: 'shoes',
        name: 'Failing notification shoes',
        alertDistanceMeters: 10_000
      })
      await addRide(database, actors.extra.id, shoes.id, 'failing', 20_000)

      await expect(
        evaluateGearServiceReminders({
          database,
          actorId: actors.extra.id,
          gearIds: [shoes.id]
        })
      ).resolves.toBeUndefined()
    })
  })
})
