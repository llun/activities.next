import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('FitnessFileDatabase', () => {
  const { actors } = DatabaseSeed
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    beforeAll(async () => {
      await seedDatabase(database)
    })

    afterAll(async () => {
      await database.destroy()
    })

    describe('getFitnessActivitySummary', () => {
      it('returns activity counts and totals grouped by type within date range', async () => {
        const run1 = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/summary-run1.fit',
          fileName: 'summary-run1.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        const run2 = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/summary-run2.fit',
          fileName: 'summary-run2.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        const cycle1 = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/summary-cycle1.fit',
          fileName: 'summary-cycle1.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        await database.updateFitnessFileActivityData(run1!.id, {
          activityType: 'running',
          activityStartTime: new Date('2026-02-10T08:00:00.000Z'),
          totalDistanceMeters: 5000,
          totalDurationSeconds: 1500,
          elevationGainMeters: 100
        })
        await database.updateFitnessFileProcessingStatus(run1!.id, 'completed')

        await database.updateFitnessFileActivityData(run2!.id, {
          activityType: 'running',
          activityStartTime: new Date('2026-02-15T09:00:00.000Z'),
          totalDistanceMeters: 8000,
          totalDurationSeconds: 2400,
          elevationGainMeters: 150
        })
        await database.updateFitnessFileProcessingStatus(run2!.id, 'completed')

        await database.updateFitnessFileActivityData(cycle1!.id, {
          activityType: 'cycling',
          activityStartTime: new Date('2026-02-12T10:00:00.000Z'),
          totalDistanceMeters: 20000,
          totalDurationSeconds: 3600,
          elevationGainMeters: 300
        })
        await database.updateFitnessFileProcessingStatus(
          cycle1!.id,
          'completed'
        )

        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: new Date('2026-02-01T00:00:00.000Z').getTime(),
          endDate: new Date('2026-03-01T00:00:00.000Z').getTime()
        })

        expect(summary).toHaveLength(2)

        const running = summary.find((s) => s.activityType === 'running')
        expect(running).toMatchObject({
          activityType: 'running',
          count: 2,
          totalDistanceMeters: 13000,
          totalDurationSeconds: 3900,
          totalElevationGainMeters: 250
        })

        const cycling = summary.find((s) => s.activityType === 'cycling')
        expect(cycling).toMatchObject({
          activityType: 'cycling',
          count: 1,
          totalDistanceMeters: 20000,
          totalDurationSeconds: 3600,
          totalElevationGainMeters: 300
        })
      })

      it('excludes fitness files outside the date range', async () => {
        const outside = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/summary-outside.fit',
          fileName: 'summary-outside.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        await database.updateFitnessFileActivityData(outside!.id, {
          activityType: 'running',
          activityStartTime: new Date('2026-06-01T08:00:00.000Z'),
          totalDistanceMeters: 3000,
          totalDurationSeconds: 900,
          elevationGainMeters: 50
        })
        await database.updateFitnessFileProcessingStatus(
          outside!.id,
          'completed'
        )

        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: new Date('2026-05-01T00:00:00.000Z').getTime(),
          endDate: new Date('2026-05-31T00:00:00.000Z').getTime()
        })

        expect(summary).toHaveLength(0)
      })

      it('returns empty array when no fitness files exist in range', async () => {
        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: new Date('2020-01-01T00:00:00.000Z').getTime(),
          endDate: new Date('2020-02-01T00:00:00.000Z').getTime()
        })

        expect(summary).toEqual([])
      })
    })

    describe('getActorHasFitnessData', () => {
      it('returns true when actor has completed fitness files', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/has-data-completed.fit',
          fileName: 'has-data-completed.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        expect(created).toBeDefined()

        await database.updateFitnessFileActivityData(created!.id, {
          activityType: 'running',
          activityStartTime: new Date()
        })
        await database.updateFitnessFileProcessingStatus(
          created!.id,
          'completed'
        )

        const result = await database.getActorHasFitnessData({
          actorId: actors.extra.id
        })
        expect(result).toBe(true)
      })

      it('returns false when actor has no fitness files', async () => {
        const result = await database.getActorHasFitnessData({
          actorId: 'non-existent-actor-id'
        })
        expect(result).toBe(false)
      })

      it('returns false when actor only has pending/failed fitness files', async () => {
        const pending = await database.createFitnessFile({
          actorId: actors.replyAuthor.id,
          path: 'fitness/has-data-pending.fit',
          fileName: 'has-data-pending.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        const failed = await database.createFitnessFile({
          actorId: actors.replyAuthor.id,
          path: 'fitness/has-data-failed.fit',
          fileName: 'has-data-failed.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        expect(pending).toBeDefined()
        expect(failed).toBeDefined()

        await database.updateFitnessFileProcessingStatus(failed!.id, 'failed')

        const result = await database.getActorHasFitnessData({
          actorId: actors.replyAuthor.id
        })
        expect(result).toBe(false)
      })
    })

    describe('getActorHasFitnessData audience scoping', () => {
      // The Fitness tab on a profile is itself a disclosure: a viewer who can
      // read none of an actor's fitness posts must not be told they exist.
      const actorId = actors.pollAuthor.id
      const followersUrl = `${actorId}/followers`

      const createCompletedFile = async (name: string, statusId?: string) => {
        const created = await database.createFitnessFile({
          actorId,
          path: `fitness/audience-${name}.fit`,
          fileName: `audience-${name}.fit`,
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024,
          statusId
        })
        await database.updateFitnessFileActivityData(created!.id, {
          activityType: 'running',
          activityStartTime: new Date()
        })
        await database.updateFitnessFileProcessingStatus(
          created!.id,
          'completed'
        )
      }

      const createNoteTo = async (
        suffix: string,
        to: string[],
        cc: string[] = []
      ) => {
        const id = `${actorId}/statuses/audience-${suffix}`
        await database.createNote({
          id,
          url: id,
          actorId,
          text: `fitness ${suffix}`,
          to,
          cc,
          createdAt: Date.now()
        })
        return id
      }

      it('only counts files attached to a status the audience can read', async () => {
        // An unattached file is the owner's alone.
        await createCompletedFile('unattached')
        expect(await database.getActorHasFitnessData({ actorId })).toBe(true)
        expect(
          await database.getActorHasFitnessData({ actorId, publicOnly: true })
        ).toBe(false)

        // A direct message to one actor reaches only that actor.
        const directStatusId = await createNoteTo('direct', [actors.primary.id])
        await createCompletedFile('direct', directStatusId)
        expect(
          await database.getActorHasFitnessData({ actorId, publicOnly: true })
        ).toBe(false)
        expect(
          await database.getActorHasFitnessData({
            actorId,
            visibleToActorId: actors.empty.id
          })
        ).toBe(false)
        expect(
          await database.getActorHasFitnessData({
            actorId,
            visibleToActorId: actors.primary.id
          })
        ).toBe(true)

        // Followers-only is visible to the followers audience, not the public.
        const followersStatusId = await createNoteTo('followers', [
          followersUrl
        ])
        await createCompletedFile('followers', followersStatusId)
        expect(
          await database.getActorHasFitnessData({ actorId, publicOnly: true })
        ).toBe(false)
        expect(
          await database.getActorHasFitnessData({
            actorId,
            visibleToActorId: actors.empty.id,
            includeFollowersOnly: true,
            followersAudience: followersUrl
          })
        ).toBe(true)

        // A public post is what makes the tab appear for everyone.
        const publicStatusId = await createNoteTo('public', [
          ACTIVITY_STREAM_PUBLIC
        ])
        await createCompletedFile('public', publicStatusId)
        expect(
          await database.getActorHasFitnessData({ actorId, publicOnly: true })
        ).toBe(true)
      })
    })

    describe('getFitnessActivityCalendarData', () => {
      beforeAll(async () => {
        const day1a = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/cal-day1a.fit',
          fileName: 'cal-day1a.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 512
        })
        const day1b = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/cal-day1b.fit',
          fileName: 'cal-day1b.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 512
        })
        const day2 = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/cal-day2.fit',
          fileName: 'cal-day2.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 512
        })

        await database.updateFitnessFileActivityData(day1a!.id, {
          activityType: 'running',
          activityStartTime: new Date('2027-03-10T08:00:00.000Z'),
          totalDistanceMeters: 5000,
          totalDurationSeconds: 1800
        })
        await database.updateFitnessFileProcessingStatus(day1a!.id, 'completed')

        await database.updateFitnessFileActivityData(day1b!.id, {
          activityType: 'cycling',
          activityStartTime: new Date('2027-03-10T17:00:00.000Z'),
          totalDistanceMeters: 15000,
          totalDurationSeconds: 3600
        })
        await database.updateFitnessFileProcessingStatus(day1b!.id, 'completed')

        await database.updateFitnessFileActivityData(day2!.id, {
          activityType: 'running',
          activityStartTime: new Date('2027-03-12T09:00:00.000Z'),
          totalDistanceMeters: 8000,
          totalDurationSeconds: 2400
        })
        await database.updateFitnessFileProcessingStatus(day2!.id, 'completed')
      })

      it('returns per-day aggregates grouped by date', async () => {
        const result = await database.getFitnessActivityCalendarData({
          timeZone: 'UTC',
          actorId: actors.extra.id,
          startDate: new Date('2027-03-01T00:00:00.000Z').getTime(),
          endDate: new Date('2027-04-01T00:00:00.000Z').getTime()
        })

        expect(result).toHaveLength(2)
        expect(result[0]).toMatchObject({
          date: '2027-03-10',
          count: 2,
          totalDistanceMeters: 20000,
          totalDurationSeconds: 5400
        })
        expect(result[1]).toMatchObject({
          date: '2027-03-12',
          count: 1,
          totalDistanceMeters: 8000,
          totalDurationSeconds: 2400
        })
      })

      it('returns empty array when no data in range', async () => {
        const result = await database.getFitnessActivityCalendarData({
          timeZone: 'UTC',
          actorId: actors.extra.id,
          startDate: new Date('2010-01-01T00:00:00.000Z').getTime(),
          endDate: new Date('2010-02-01T00:00:00.000Z').getTime()
        })

        expect(result).toEqual([])
      })

      it('filters by activityType when provided', async () => {
        const result = await database.getFitnessActivityCalendarData({
          timeZone: 'UTC',
          actorId: actors.extra.id,
          startDate: new Date('2027-03-01T00:00:00.000Z').getTime(),
          endDate: new Date('2027-04-01T00:00:00.000Z').getTime(),
          activityType: 'running'
        })

        expect(result).toHaveLength(2)
        expect(result[0]).toMatchObject({
          date: '2027-03-10',
          count: 1,
          totalDistanceMeters: 5000,
          totalDurationSeconds: 1800
        })
        expect(result[1]).toMatchObject({
          date: '2027-03-12',
          count: 1,
          totalDistanceMeters: 8000,
          totalDurationSeconds: 2400
        })
      })

      it('excludes deleted and non-primary files', async () => {
        const deleted = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/cal-deleted.fit',
          fileName: 'cal-deleted.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 512
        })
        await database.updateFitnessFileActivityData(deleted!.id, {
          activityType: 'running',
          activityStartTime: new Date('2027-04-05T08:00:00.000Z'),
          totalDistanceMeters: 3000,
          totalDurationSeconds: 900
        })
        await database.updateFitnessFileProcessingStatus(
          deleted!.id,
          'completed'
        )
        await database.deleteFitnessFile({ id: deleted!.id })

        const nonPrimary = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/cal-nonprimary.fit',
          fileName: 'cal-nonprimary.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 512
        })
        await database.updateFitnessFileActivityData(nonPrimary!.id, {
          activityType: 'running',
          activityStartTime: new Date('2027-04-06T08:00:00.000Z'),
          totalDistanceMeters: 4000,
          totalDurationSeconds: 1200
        })
        await database.updateFitnessFileProcessingStatus(
          nonPrimary!.id,
          'completed'
        )
        await database.updateFitnessFilePrimary(nonPrimary!.id, false)

        const result = await database.getFitnessActivityCalendarData({
          timeZone: 'UTC',
          actorId: actors.extra.id,
          startDate: new Date('2027-04-01T00:00:00.000Z').getTime(),
          endDate: new Date('2027-05-01T00:00:00.000Z').getTime()
        })

        expect(result).toEqual([])
      })
    })
  })
})
