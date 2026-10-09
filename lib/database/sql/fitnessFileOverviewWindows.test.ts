import {
  databaseBeforeAll,
  getTestDatabaseTable
} from '@/lib/database/testUtils'
import {
  DateKey,
  instantAtLocalWallTime,
  localDayWindow,
  parseDateKey,
  startOfLocalDay
} from '@/lib/fitness/calendar/localDay'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'
import { FitnessProcessingStatus } from '@/lib/types/database/fitnessFile'

describe('FitnessFileDatabase', () => {
  const { actors, statuses } = DatabaseSeed
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

    describe('fitness overview local-day windows', () => {
      // Every case seeds its own month (or year) so rows never leak into
      // another case's window: the database is shared by the whole file, and
      // `actors.extra` already holds rows in 2026 and 2027.
      const AMSTERDAM = 'Europe/Amsterdam'
      const LOS_ANGELES = 'America/Los_Angeles'
      const HOUR_MS = 60 * 60 * 1000

      const dayKey = (value: string): DateKey => {
        const key = parseDateKey(value)
        if (!key) throw new Error(`Bad date key in test: ${value}`)
        return key
      }
      const windowOf = (from: string, to: string, timeZone: string) =>
        localDayWindow(dayKey(from), dayKey(to), timeZone)
      const at = (date: string, time: string, timeZone: string) =>
        instantAtLocalWallTime(dayKey(date), time, timeZone)

      interface SeedActivity {
        startTime: number | null
        activityType?: string
        distance?: number
        duration?: number
        elevation?: number
        processingStatus?: FitnessProcessingStatus
        primary?: boolean
        deleted?: boolean
        statusId?: string
        actorId?: string
      }

      let sequence = 0
      const seedActivity = async ({
        startTime,
        activityType = 'running',
        distance = 1000,
        duration = 600,
        elevation = 10,
        processingStatus = 'completed',
        primary = true,
        deleted = false,
        statusId,
        actorId = actors.extra.id
      }: SeedActivity) => {
        sequence += 1
        const created = await database.createFitnessFile({
          actorId,
          path: `fitness/overview-window-${sequence}.fit`,
          fileName: `overview-window-${sequence}.fit`,
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 256
        })
        await database.updateFitnessFileActivityData(created!.id, {
          ...(activityType ? { activityType } : {}),
          ...(startTime === null
            ? {}
            : { activityStartTime: new Date(startTime) }),
          totalDistanceMeters: distance,
          totalDurationSeconds: duration,
          elevationGainMeters: elevation
        })
        await database.updateFitnessFileProcessingStatus(
          created!.id,
          processingStatus
        )
        if (!primary)
          await database.updateFitnessFilePrimary(created!.id, false)
        if (statusId) {
          await database.updateFitnessFileStatus(created!.id, statusId)
        }
        if (deleted) await database.deleteFitnessFile({ id: created!.id })
        return created!.id
      }

      const calendar = (
        from: string,
        to: string,
        timeZone: string,
        activityType?: string
      ) => {
        const { startMs, endMs } = windowOf(from, to, timeZone)
        return database.getFitnessActivityCalendarData({
          actorId: actors.extra.id,
          startDate: startMs,
          endDate: endMs,
          timeZone,
          activityType
        })
      }

      const readWindow = async (
        from: string,
        to: string,
        timeZone: string,
        pageSize = 50
      ) => {
        const { startMs, endMs } = windowOf(from, to, timeZone)
        const activities = []
        let offset = 0
        for (;;) {
          const page = await database.getFitnessActivitiesInWindow({
            actorId: actors.extra.id,
            startDate: startMs,
            endDate: endMs,
            limit: pageSize,
            offset
          })
          activities.push(...page.activities)
          offset += page.activities.length
          if (!page.hasMore) return activities
        }
      }

      it('keeps a missing distance, duration and elevation null in the window read', async () => {
        const created = await database.createFitnessFile({
          actorId: actors.extra.id,
          path: 'fitness/null-totals.fit',
          fileName: 'null-totals.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 256
        })
        await database.updateFitnessFileActivityData(created!.id, {
          activityType: 'strength',
          activityStartTime: new Date(at('2035-05-10', '09:00', AMSTERDAM))
        })
        await database.updateFitnessFileProcessingStatus(
          created!.id,
          'completed'
        )
        const rows = await readWindow('2035-05-10', '2035-05-10', AMSTERDAM)
        expect(rows).toHaveLength(1)
        expect(rows[0].totalDistanceMeters).toBeNull()
        expect(rows[0].totalDurationSeconds).toBeNull()
        expect(rows[0].elevationGainMeters).toBeNull()
      })

      it('buckets early-morning and late-night activities by the local day', async () => {
        await seedActivity({ startTime: at('2031-06-10', '00:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-06-10', '23:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-06-11', '00:00', AMSTERDAM) })

        // 00:30 Amsterdam in summer is 22:30Z the previous day.
        expect(
          new Date(at('2031-06-10', '00:30', AMSTERDAM)).toISOString()
        ).toBe('2031-06-09T22:30:00.000Z')

        const local = await calendar('2031-06-01', '2031-06-30', AMSTERDAM)
        expect(local.map((day) => [day.date, day.count])).toEqual([
          ['2031-06-10', 2],
          ['2031-06-11', 1]
        ])

        // The same rows bucketed in UTC land on different days, which is the
        // whole reason the zone has to travel with the request.
        const utc = await calendar('2031-06-01', '2031-06-30', 'UTC')
        expect(utc.map((day) => [day.date, day.count])).toEqual([
          ['2031-06-09', 1],
          ['2031-06-10', 2]
        ])
      })

      it('buckets west-of-UTC evenings on the local day, not the UTC day', async () => {
        await seedActivity({
          startTime: at('2031-07-10', '23:30', LOS_ANGELES)
        })
        await seedActivity({
          startTime: at('2031-07-11', '00:30', LOS_ANGELES)
        })

        // 23:30 Los Angeles is already the next day in UTC.
        expect(
          new Date(at('2031-07-10', '23:30', LOS_ANGELES)).toISOString()
        ).toBe('2031-07-11T06:30:00.000Z')

        const local = await calendar('2031-07-01', '2031-07-31', LOS_ANGELES)
        expect(local.map((day) => [day.date, day.count])).toEqual([
          ['2031-07-10', 1],
          ['2031-07-11', 1]
        ])
      })

      it('treats the window as half-open at the local day boundaries', async () => {
        const startOfDay = startOfLocalDay(dayKey('2031-08-10'), AMSTERDAM)
        const startOfNextDay = startOfLocalDay(dayKey('2031-08-11'), AMSTERDAM)
        await seedActivity({ startTime: startOfDay - 1 })
        await seedActivity({ startTime: startOfDay })
        await seedActivity({ startTime: startOfNextDay - 1 })
        await seedActivity({ startTime: startOfNextDay })

        const days = await calendar('2031-08-10', '2031-08-10', AMSTERDAM)
        expect(days.map((day) => [day.date, day.count])).toEqual([
          ['2031-08-10', 2]
        ])
        const rows = await readWindow('2031-08-10', '2031-08-10', AMSTERDAM)
        expect(rows.map((row) => row.startTime)).toEqual([
          startOfDay,
          startOfNextDay - 1
        ])
      })

      it('keeps spring-forward and fall-back days whole, including the repeated hour', async () => {
        const spring = windowOf('2031-03-30', '2031-03-30', AMSTERDAM)
        const fall = windowOf('2031-10-26', '2031-10-26', AMSTERDAM)
        expect((spring.endMs - spring.startMs) / HOUR_MS).toBe(23)
        expect((fall.endMs - fall.startMs) / HOUR_MS).toBe(25)

        await seedActivity({ startTime: at('2031-03-29', '23:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-03-30', '00:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-03-30', '23:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-03-31', '00:30', AMSTERDAM) })

        const firstPass = at('2031-10-26', '02:30', AMSTERDAM)
        await seedActivity({ startTime: at('2031-10-26', '00:30', AMSTERDAM) })
        await seedActivity({ startTime: firstPass })
        // The same wall-clock time an hour later: the repeated hour.
        await seedActivity({ startTime: firstPass + HOUR_MS })
        await seedActivity({ startTime: at('2031-10-26', '23:30', AMSTERDAM) })
        await seedActivity({ startTime: at('2031-10-27', '00:30', AMSTERDAM) })

        const springDays = await calendar('2031-03-01', '2031-03-31', AMSTERDAM)
        expect(springDays.map((day) => [day.date, day.count])).toEqual([
          ['2031-03-29', 1],
          ['2031-03-30', 2],
          ['2031-03-31', 1]
        ])

        const fallDays = await calendar('2031-10-01', '2031-10-31', AMSTERDAM)
        expect(fallDays.map((day) => [day.date, day.count])).toEqual([
          ['2031-10-26', 4],
          ['2031-10-27', 1]
        ])

        const fallRows = await readWindow('2031-10-26', '2031-10-26', AMSTERDAM)
        expect(fallRows).toHaveLength(4)
      })

      it('buckets leap-day activities on 29 February', async () => {
        await seedActivity({ startTime: at('2032-02-28', '23:50', AMSTERDAM) })
        await seedActivity({ startTime: at('2032-02-29', '00:10', AMSTERDAM) })
        await seedActivity({ startTime: at('2032-02-29', '23:50', AMSTERDAM) })
        await seedActivity({ startTime: at('2032-03-01', '00:10', AMSTERDAM) })

        const days = await calendar('2032-02-01', '2032-03-31', AMSTERDAM)
        expect(days.map((day) => [day.date, day.count])).toEqual([
          ['2032-02-28', 1],
          ['2032-02-29', 2],
          ['2032-03-01', 1]
        ])

        const leapDay = await readWindow('2032-02-29', '2032-02-29', AMSTERDAM)
        expect(leapDay).toHaveLength(2)
      })

      it('sums distance, duration and elevation per local day', async () => {
        await seedActivity({
          startTime: at('2032-04-05', '07:00', AMSTERDAM),
          distance: 5000,
          duration: 1500,
          elevation: 40
        })
        await seedActivity({
          startTime: at('2032-04-05', '18:00', AMSTERDAM),
          distance: 12000,
          duration: 3000,
          elevation: 120
        })

        const days = await calendar('2032-04-01', '2032-04-30', AMSTERDAM)
        expect(days).toEqual([
          {
            date: '2032-04-05',
            count: 2,
            totalDistanceMeters: 17000,
            totalDurationSeconds: 4500,
            totalElevationGainMeters: 160
          }
        ])
      })

      it('paginates the window with limit+1 and reports hasMore', async () => {
        const base = at('2032-05-10', '06:00', AMSTERDAM)
        for (let index = 0; index < 5; index += 1) {
          await seedActivity({ startTime: base + index * HOUR_MS })
        }
        const { startMs, endMs } = windowOf(
          '2032-05-10',
          '2032-05-10',
          AMSTERDAM
        )
        const page = (limit: number, offset: number) =>
          database.getFitnessActivitiesInWindow({
            actorId: actors.extra.id,
            startDate: startMs,
            endDate: endMs,
            limit,
            offset
          })

        const first = await page(2, 0)
        const second = await page(2, 2)
        const third = await page(2, 4)
        expect(first.activities.map((row) => row.startTime)).toEqual([
          base,
          base + HOUR_MS
        ])
        expect(first.hasMore).toBe(true)
        expect(second.activities.map((row) => row.startTime)).toEqual([
          base + 2 * HOUR_MS,
          base + 3 * HOUR_MS
        ])
        expect(second.hasMore).toBe(true)
        expect(third.activities.map((row) => row.startTime)).toEqual([
          base + 4 * HOUR_MS
        ])
        expect(third.hasMore).toBe(false)

        // A page that ends exactly on the last row has nothing more.
        const exact = await page(5, 0)
        expect(exact.activities).toHaveLength(5)
        expect(exact.hasMore).toBe(false)
        const beyond = await page(2, 10)
        expect(beyond).toEqual({ activities: [], hasMore: false })
      })

      it('orders rows that share a start time by id so pages never repeat', async () => {
        const startTime = at('2032-05-20', '08:00', AMSTERDAM)
        const ids = [
          await seedActivity({ startTime }),
          await seedActivity({ startTime }),
          await seedActivity({ startTime })
        ]
        const rows = await readWindow('2032-05-20', '2032-05-20', AMSTERDAM, 1)
        expect(rows.map((row) => row.id)).toEqual([...ids].sort())
      })

      it('returns the fields the day details need, including a null statusId', async () => {
        const linked = await seedActivity({
          startTime: at('2032-06-01', '07:00', AMSTERDAM),
          statusId: statuses.primary.post,
          activityType: 'cycling',
          distance: 30000,
          duration: 3600,
          elevation: 250
        })
        const unlinked = await seedActivity({
          startTime: at('2032-06-01', '09:00', AMSTERDAM)
        })

        const rows = await readWindow('2032-06-01', '2032-06-01', AMSTERDAM)
        expect(rows).toHaveLength(2)
        expect(rows[0]).toMatchObject({
          id: linked,
          statusId: statuses.primary.post,
          activityType: 'cycling',
          startTime: at('2032-06-01', '07:00', AMSTERDAM),
          totalDistanceMeters: 30000,
          totalDurationSeconds: 3600,
          elevationGainMeters: 250
        })
        expect(rows[1]).toMatchObject({ id: unlinked, statusId: null })
        expect(typeof rows[0].fileName).toBe('string')
      })

      it('excludes non-primary, failed, pending, deleted and untimed files everywhere', async () => {
        const startTime = at('2032-09-10', '10:00', AMSTERDAM)
        const counted = await seedActivity({ startTime, distance: 1000 })
        await seedActivity({ startTime, primary: false, distance: 7000 })
        await seedActivity({
          startTime,
          processingStatus: 'failed',
          distance: 7000
        })
        await seedActivity({
          startTime,
          processingStatus: 'pending',
          distance: 7000
        })
        await seedActivity({ startTime, deleted: true, distance: 7000 })
        await seedActivity({ startTime: null, distance: 7000 })

        const days = await calendar('2032-09-01', '2032-09-30', AMSTERDAM)
        expect(days).toEqual([
          {
            date: '2032-09-10',
            count: 1,
            totalDistanceMeters: 1000,
            totalDurationSeconds: 600,
            totalElevationGainMeters: 10
          }
        ])

        const { startMs, endMs } = windowOf(
          '2032-09-01',
          '2032-09-30',
          AMSTERDAM
        )
        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: startMs,
          endDate: endMs
        })
        expect(summary).toEqual([
          {
            activityType: 'running',
            count: 1,
            totalDistanceMeters: 1000,
            totalDurationSeconds: 600,
            totalElevationGainMeters: 10
          }
        ])

        const rows = await readWindow('2032-09-01', '2032-09-30', AMSTERDAM)
        expect(rows.map((row) => row.id)).toEqual([counted])
      })

      it('reads only the requested actor, in the summary, calendar and day window', async () => {
        const startTime = at('2033-03-10', '10:00', AMSTERDAM)
        const mine = await seedActivity({ startTime, distance: 1000 })
        await seedActivity({
          startTime,
          distance: 7000,
          actorId: actors.primary.id
        })

        const days = await calendar('2033-03-01', '2033-03-31', AMSTERDAM)
        expect(
          days.map((day) => [day.date, day.count, day.totalDistanceMeters])
        ).toEqual([['2033-03-10', 1, 1000]])

        const { startMs, endMs } = windowOf(
          '2033-03-01',
          '2033-03-31',
          AMSTERDAM
        )
        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: startMs,
          endDate: endMs
        })
        expect(summary).toEqual([
          expect.objectContaining({ count: 1, totalDistanceMeters: 1000 })
        ])

        const rows = await readWindow('2033-03-01', '2033-03-31', AMSTERDAM)
        expect(rows.map((row) => row.id)).toEqual([mine])
      })

      it('counts untyped activities as their own group, never as the string "null"', async () => {
        await seedActivity({
          startTime: at('2032-10-05', '07:00', AMSTERDAM),
          activityType: 'running',
          distance: 4000,
          duration: 1200,
          elevation: 20
        })
        await seedActivity({
          startTime: at('2032-10-05', '12:00', AMSTERDAM),
          activityType: '',
          distance: 3000,
          duration: 900,
          elevation: 5
        })
        await seedActivity({
          startTime: at('2032-10-06', '12:00', AMSTERDAM),
          activityType: '',
          distance: 2000,
          duration: 600,
          elevation: 5
        })

        const { startMs, endMs } = windowOf(
          '2032-10-01',
          '2032-10-31',
          AMSTERDAM
        )
        const summary = await database.getFitnessActivitySummary({
          actorId: actors.extra.id,
          startDate: startMs,
          endDate: endMs
        })
        expect(summary.map((row) => row.activityType)).not.toContain('null')
        expect(summary).toHaveLength(2)
        expect(summary.find((row) => row.activityType === null)).toEqual({
          activityType: null,
          count: 2,
          totalDistanceMeters: 5000,
          totalDurationSeconds: 1500,
          totalElevationGainMeters: 10
        })
        expect(
          summary.find((row) => row.activityType === 'running')
        ).toMatchObject({ count: 1, totalDistanceMeters: 4000 })

        const days = await calendar('2032-10-01', '2032-10-31', AMSTERDAM)
        expect(days.map((day) => [day.date, day.count])).toEqual([
          ['2032-10-05', 2],
          ['2032-10-06', 1]
        ])
        expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(
          summary.reduce((sum, row) => sum + row.count, 0)
        )

        const typed = await calendar(
          '2032-10-01',
          '2032-10-31',
          AMSTERDAM,
          'running'
        )
        expect(typed.map((day) => [day.date, day.count])).toEqual([
          ['2032-10-05', 1]
        ])

        const rows = await readWindow('2032-10-01', '2032-10-31', AMSTERDAM)
        expect(rows.map((row) => row.activityType)).toEqual([
          'running',
          null,
          null
        ])
      })

      describe('aggregates and day details agree', () => {
        // One fixture spanning a month, with rows near every zone's midnight,
        // untyped rows and several per day, so each zone buckets it differently.
        const FIXTURE_FROM = '2033-03-01'
        const FIXTURE_TO = '2033-03-31'

        beforeAll(async () => {
          const month = Date.UTC(2033, 2, 1)
          const hours = [0.5, 3, 7.5, 12, 16.25, 21, 22.5, 23.75]
          for (let day = 0; day < 31; day += 1) {
            for (const [index, hour] of hours.entries()) {
              // A deterministic, uneven pattern: some days empty, some busy.
              if ((day * 7 + index * 3) % 5 !== 0) continue
              await seedActivity({
                startTime: month + day * 24 * HOUR_MS + hour * HOUR_MS,
                activityType: index % 3 === 0 ? '' : 'running',
                distance: 1000 + day * 10 + index,
                duration: 600 + index * 30,
                elevation: day + index
              })
            }
          }
        })

        it.each([AMSTERDAM, LOS_ANGELES, 'Asia/Kathmandu', 'UTC'])(
          'matches the sum of the day window for every calendar day in %s',
          async (timeZone) => {
            const days = await calendar(FIXTURE_FROM, FIXTURE_TO, timeZone)
            expect(days.length).toBeGreaterThan(10)

            let windowRows = 0
            for (const day of days) {
              // Pages of two, so the agreement is also checked across pages.
              const rows = await readWindow(day.date, day.date, timeZone, 2)
              windowRows += rows.length
              expect(rows).toHaveLength(day.count)
              expect(
                rows.reduce(
                  (sum, row) => sum + (row.totalDistanceMeters ?? 0),
                  0
                )
              ).toBe(day.totalDistanceMeters)
              expect(
                rows.reduce(
                  (sum, row) => sum + (row.totalDurationSeconds ?? 0),
                  0
                )
              ).toBe(day.totalDurationSeconds)
              expect(
                rows.reduce(
                  (sum, row) => sum + (row.elevationGainMeters ?? 0),
                  0
                )
              ).toBe(day.totalElevationGainMeters)
            }

            // Reading the whole range at once finds the same rows, so no day
            // window dropped or duplicated one.
            const all = await readWindow(FIXTURE_FROM, FIXTURE_TO, timeZone)
            expect(all).toHaveLength(windowRows)
            expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(
              all.length
            )
          }
        )

        it.each([AMSTERDAM, LOS_ANGELES, 'Asia/Kathmandu'])(
          'matches the summary totals for the same range in %s',
          async (timeZone) => {
            const days = await calendar(FIXTURE_FROM, FIXTURE_TO, timeZone)
            const { startMs, endMs } = windowOf(
              FIXTURE_FROM,
              FIXTURE_TO,
              timeZone
            )
            const summary = await database.getFitnessActivitySummary({
              actorId: actors.extra.id,
              startDate: startMs,
              endDate: endMs
            })
            const sum = (values: number[]) =>
              values.reduce((total, value) => total + value, 0)

            expect(sum(summary.map((row) => row.count))).toBe(
              sum(days.map((day) => day.count))
            )
            expect(sum(summary.map((row) => row.totalDistanceMeters))).toBe(
              sum(days.map((day) => day.totalDistanceMeters))
            )
            expect(sum(summary.map((row) => row.totalDurationSeconds))).toBe(
              sum(days.map((day) => day.totalDurationSeconds))
            )
            expect(
              sum(summary.map((row) => row.totalElevationGainMeters))
            ).toBe(sum(days.map((day) => day.totalElevationGainMeters)))
            expect(summary.some((row) => row.activityType === null)).toBe(true)
          }
        )
      })

      it('rejects an unknown time zone instead of bucketing in the wrong one', async () => {
        await expect(
          database.getFitnessActivityCalendarData({
            actorId: actors.extra.id,
            startDate: 0,
            endDate: 1,
            timeZone: 'Not/AZone'
          })
        ).rejects.toThrow(RangeError)
      })

      describe('getFitnessActivityTimeBounds', () => {
        it('returns null earliest when the actor has no countable activity', async () => {
          await expect(
            database.getFitnessActivityTimeBounds({
              actorId: 'non-existent-actor-id'
            })
          ).resolves.toEqual({ earliest: null })
        })

        it('returns the earliest countable start, ignoring excluded rows', async () => {
          const longAgo = Date.UTC(1999, 0, 1)
          // None of these count, so none may become the earliest.
          await seedActivity({ startTime: longAgo, processingStatus: 'failed' })
          await seedActivity({ startTime: longAgo + HOUR_MS, primary: false })
          await seedActivity({
            startTime: longAgo + 2 * HOUR_MS,
            deleted: true
          })
          await seedActivity({ startTime: null })

          const bounds = await database.getFitnessActivityTimeBounds({
            actorId: actors.extra.id
          })
          const firstCountable = await database.getFitnessActivitiesInWindow({
            actorId: actors.extra.id,
            startDate: 0,
            endDate: Date.UTC(2100, 0, 1),
            limit: 1,
            offset: 0
          })
          expect(firstCountable.activities).toHaveLength(1)
          expect(bounds.earliest).toBe(firstCountable.activities[0].startTime)
          expect(bounds.earliest).toBeGreaterThan(longAgo + 3 * HOUR_MS)
        })
      })
    })
  })
})
