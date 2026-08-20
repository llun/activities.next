import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestDatabaseWithInstance
} from '@/lib/database/testUtils'
import { seedDatabase } from '@/lib/stub/database'
import { DatabaseSeed } from '@/lib/stub/scenarios/database'

describe('FitnessRouteHeatmapDatabase', () => {
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

    describe('createFitnessRouteHeatmap / getFitnessRouteHeatmap', () => {
      it('creates and retrieves a route cache record', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2026',
          region: '',
          periodStart: new Date('2026-01-01T00:00:00Z'),
          periodEnd: new Date('2027-01-01T00:00:00Z')
        })

        expect(created).toMatchObject({
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2026',
          region: '',
          status: 'pending',
          activityCount: 0,
          pointCount: 0,
          cursorOffset: 0,
          isPartial: false,
          segments: []
        })

        const fetched = await database.getFitnessRouteHeatmap({
          id: created.id
        })
        expect(fetched?.id).toBe(created.id)
        expect(fetched?.segments).toEqual([])
      })

      it('uses stable keys for all-activity caches', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })

        const found = await database.getFitnessRouteHeatmapByKey({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all'
        })

        expect(found?.id).toBe(created.id)
        expect(found?.activityType).toBeUndefined()
      })
    })

    describe('updateFitnessRouteHeatmapStatus', () => {
      it('stores bounds, segments, counts, and errors as route payload', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'cycling',
          periodType: 'monthly',
          periodKey: '2026-04',
          region: 'netherlands'
        })

        const updated = await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'completed',
          bounds: {
            minLat: 52,
            maxLat: 53,
            minLng: 4,
            maxLng: 5
          },
          segments: [
            {
              points: [
                { lat: 52.1, lng: 4.3 },
                { lat: 52.2, lng: 4.4 }
              ]
            },
            {
              isHiddenByPrivacy: true,
              points: [
                { lat: 52.3, lng: 4.5 },
                { lat: 52.4, lng: 4.6 }
              ]
            }
          ],
          activityCount: 2,
          pointCount: 4,
          cursorOffset: 25,
          isPartial: true,
          error: null
        })

        expect(updated).toBe(true)

        const fetched = await database.getFitnessRouteHeatmap({
          id: created.id
        })
        expect(fetched?.status).toBe('completed')
        expect(fetched?.bounds).toEqual({
          minLat: 52,
          maxLat: 53,
          minLng: 4,
          maxLng: 5
        })
        expect(fetched?.segments).toHaveLength(2)
        expect(fetched?.activityCount).toBe(2)
        expect(fetched?.pointCount).toBe(4)
        expect(fetched?.cursorOffset).toBe(25)
        expect(fetched?.isPartial).toBe(true)
      })

      it('persists totalCount as the progress denominator', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-05',
          region: 'total-count-test'
        })

        // Fresh rows start at 0 (denominator not yet computed).
        expect(created.totalCount).toBe(0)

        const updated = await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'generating',
          totalCount: 42,
          cursorOffset: 7
        })
        expect(updated).toBe(true)

        const fetched = await database.getFitnessRouteHeatmap({
          id: created.id
        })
        expect(fetched?.totalCount).toBe(42)
        expect(fetched?.cursorOffset).toBe(7)

        const [summary] =
          await database.getFitnessRouteHeatmapSummariesForActor({
            actorId: actors.replyAuthor.id,
            region: 'total-count-test'
          })
        expect(summary?.totalCount).toBe(42)
      })

      it('returns false for non-existent ids', async () => {
        const result = await database.updateFitnessRouteHeatmapStatus({
          id: 'missing-route-cache',
          status: 'completed'
        })

        expect(result).toBe(false)
      })

      it('does not revive a route cache deleted after the restore cutoff', async () => {
        const cutoff = Date.now() - 10_000
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'delete-race-sql',
          periodType: 'monthly',
          periodKey: '2099-03'
        })

        await database.deleteFitnessRouteHeatmapsForActor({
          actorId: actors.replyAuthor.id
        })

        const result = await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'generating',
          clearDeleted: true,
          clearDeletedBefore: cutoff
        })

        expect(result).toBe(false)
        await expect(
          database.getFitnessRouteHeatmap({ id: created.id })
        ).resolves.toBeNull()
      })

      it('does not revive a deleted route cache without an explicit restore cutoff', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'delete-default-cutoff-sql',
          periodType: 'monthly',
          periodKey: '2099-04'
        })

        await database.deleteFitnessRouteHeatmapsForActor({
          actorId: actors.replyAuthor.id
        })

        const result = await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'generating',
          clearDeleted: true
        })

        expect(result).toBe(false)
        await expect(
          database.getFitnessRouteHeatmap({ id: created.id })
        ).resolves.toBeNull()
      })

      it('refuses to revive a cancelled row when abortIfCancelled is set', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2099-05',
          region: 'abort-if-cancelled-test'
        })
        await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'cancelled'
        })

        // A guarded worker write (checkpoint/complete/fail) must not resurrect it.
        await expect(
          database.updateFitnessRouteHeatmapStatus({
            id: created.id,
            status: 'generating',
            cursorOffset: 5,
            abortIfCancelled: true
          })
        ).resolves.toBe(false)
        await expect(
          database.getFitnessRouteHeatmap({ id: created.id })
        ).resolves.toMatchObject({ status: 'cancelled' })

        // Without the flag the same write goes through — proving the guard, not
        // some other filter, is what blocked it.
        await expect(
          database.updateFitnessRouteHeatmapStatus({
            id: created.id,
            status: 'generating'
          })
        ).resolves.toBe(true)
      })
    })

    describe('getFitnessRouteHeatmapsForActor', () => {
      it('filters by actor, activity type, period type, and region', async () => {
        await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'walking',
          periodType: 'yearly',
          periodKey: '2026',
          region: 'singapore'
        })
        await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'walking',
          periodType: 'monthly',
          periodKey: '2026-01',
          region: 'netherlands'
        })

        const results = await database.getFitnessRouteHeatmapsForActor({
          actorId: actors.primary.id,
          activityType: 'walking',
          periodType: 'yearly',
          region: 'singapore'
        })

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
          activityType: 'walking',
          periodType: 'yearly',
          region: 'singapore'
        })
      })

      it('returns summaries without route payload columns', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2027',
          region: 'summary-test'
        })
        await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'completed',
          bounds: {
            minLat: 52,
            maxLat: 53,
            minLng: 4,
            maxLng: 5
          },
          segments: [
            {
              points: [
                { lat: 52.1, lng: 4.2 },
                { lat: 52.2, lng: 4.3 }
              ]
            }
          ],
          activityCount: 1,
          pointCount: 2,
          isPartial: true
        })

        const summaries =
          await database.getFitnessRouteHeatmapSummariesForActor({
            actorId: actors.replyAuthor.id,
            region: 'summary-test'
          })

        expect(summaries).toHaveLength(1)
        expect(summaries[0]).toMatchObject({
          id: created.id,
          activityType: 'running',
          pointCount: 2,
          isPartial: true
        })
        expect('bounds' in summaries[0]).toBe(false)
        expect('segments' in summaries[0]).toBe(false)
      })

      it('returns distinct non-empty route heatmap regions for an actor', async () => {
        await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: null,
          periodType: 'monthly',
          periodKey: '2027-01',
          region: 'netherlands'
        })
        await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: null,
          periodType: 'monthly',
          periodKey: '2027-02',
          region: 'netherlands'
        })
        await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: null,
          periodType: 'monthly',
          periodKey: '2027-03',
          region: 'singapore'
        })

        await expect(
          database.getDistinctRouteHeatmapRegionsForActor({
            actorId: actors.replyAuthor.id
          })
        ).resolves.toEqual(expect.arrayContaining(['netherlands', 'singapore']))

        await database.deleteFitnessRouteHeatmapsForActor({
          actorId: actors.replyAuthor.id
        })

        await expect(
          database.getDistinctRouteHeatmapRegionsForActor({
            actorId: actors.replyAuthor.id
          })
        ).resolves.toEqual([])
        await expect(
          database.getDistinctRouteHeatmapRegionsForActor({
            actorId: actors.replyAuthor.id,
            includeDeleted: true
          })
        ).resolves.toEqual(expect.arrayContaining(['netherlands', 'singapore']))
      })
    })

    describe('getDistinctActivityTypesForActor', () => {
      it('returns distinct completed primary activity types from fitness files', async () => {
        const running = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/route-heatmap-test-run.fit',
          fileName: 'run.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })
        const cycling = await database.createFitnessFile({
          actorId: actors.primary.id,
          path: 'fitness/route-heatmap-test-cycle.fit',
          fileName: 'cycle.fit',
          fileType: 'fit',
          mimeType: 'application/vnd.ant.fit',
          bytes: 1024
        })

        expect(running).toBeDefined()
        expect(cycling).toBeDefined()

        await database.updateFitnessFileActivityData(running!.id, {
          activityType: 'running',
          activityStartTime: new Date('2026-01-15T08:00:00Z')
        })
        await database.updateFitnessFileProcessingStatus(
          running!.id,
          'completed'
        )
        await database.updateFitnessFileActivityData(cycling!.id, {
          activityType: 'cycling',
          activityStartTime: new Date('2026-01-16T08:00:00Z')
        })
        await database.updateFitnessFileProcessingStatus(
          cycling!.id,
          'completed'
        )

        const types = await database.getDistinctActivityTypesForActor({
          actorId: actors.primary.id
        })

        expect(types).toContain('running')
        expect(types).toContain('cycling')
        expect(types).toEqual([...types].sort())
      })
    })

    describe('deleteFitnessRouteHeatmapsForActor', () => {
      it('soft-deletes route heatmaps for an actor', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: 'hiking',
          periodType: 'monthly',
          periodKey: '2026-03'
        })

        const deletedCount = await database.deleteFitnessRouteHeatmapsForActor({
          actorId: actors.replyAuthor.id
        })

        expect(deletedCount).toBeGreaterThan(0)
        await expect(
          database.getFitnessRouteHeatmap({ id: created.id })
        ).resolves.toBeNull()
      })
    })

    describe('deleteFitnessRouteHeatmap', () => {
      it('soft-deletes a single heatmap scoped to its owner', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-06',
          region: 'single-delete-test'
        })

        // A different actor cannot delete it.
        await expect(
          database.deleteFitnessRouteHeatmap({
            actorId: actors.replyAuthor.id,
            id: created.id
          })
        ).resolves.toBe(false)
        await expect(
          database.getFitnessRouteHeatmap({ id: created.id })
        ).resolves.not.toBeNull()

        // The owner can.
        await expect(
          database.deleteFitnessRouteHeatmap({
            actorId: actors.primary.id,
            id: created.id
          })
        ).resolves.toBe(true)
        await expect(
          database.getFitnessRouteHeatmap({ id: created.id })
        ).resolves.toBeNull()

        // A second delete is a no-op (already removed).
        await expect(
          database.deleteFitnessRouteHeatmap({
            actorId: actors.primary.id,
            id: created.id
          })
        ).resolves.toBe(false)
      })

      it('returns false for unknown ids', async () => {
        await expect(
          database.deleteFitnessRouteHeatmap({
            actorId: actors.primary.id,
            id: 'missing-single-delete'
          })
        ).resolves.toBe(false)
      })
    })

    describe('cancelFitnessRouteHeatmapGeneration', () => {
      it('cancels an in-flight run and resets it, scoped to its owner', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-07',
          region: 'cancel-test'
        })
        await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'generating',
          segments: [
            {
              points: [
                { lat: 52.1, lng: 4.1 },
                { lat: 52.2, lng: 4.2 }
              ]
            }
          ],
          activityCount: 1,
          pointCount: 2,
          cursorOffset: 5,
          isPartial: false,
          error: null
        })

        // A different actor cannot cancel it.
        await expect(
          database.cancelFitnessRouteHeatmapGeneration({
            actorId: actors.replyAuthor.id,
            id: created.id
          })
        ).resolves.toBe(false)

        // The owner can; the run is reset to a clean cancelled state.
        await expect(
          database.cancelFitnessRouteHeatmapGeneration({
            actorId: actors.primary.id,
            id: created.id
          })
        ).resolves.toBe(true)
        const cancelled = await database.getFitnessRouteHeatmap({
          id: created.id
        })
        expect(cancelled?.status).toBe('cancelled')
        expect(cancelled?.cursorOffset).toBe(0)
        expect(cancelled?.segments).toEqual([])
        expect(cancelled?.activityCount).toBe(0)
        expect(cancelled?.pointCount).toBe(0)
      })

      it('is a no-op for a terminal (completed) run', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-08',
          region: 'cancel-terminal-test'
        })
        await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'completed'
        })
        await expect(
          database.cancelFitnessRouteHeatmapGeneration({
            actorId: actors.primary.id,
            id: created.id
          })
        ).resolves.toBe(false)
        const still = await database.getFitnessRouteHeatmap({ id: created.id })
        expect(still?.status).toBe('completed')
      })

      it('cancels a queued (pending) run before it has started', async () => {
        // Fresh rows are 'pending' — a queued-but-not-started run is a common
        // "stuck" shape and must be cancellable.
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'monthly',
          periodKey: '2026-09',
          region: 'cancel-pending-test'
        })
        expect(created.status).toBe('pending')

        await expect(
          database.cancelFitnessRouteHeatmapGeneration({
            actorId: actors.primary.id,
            id: created.id
          })
        ).resolves.toBe(true)
        const cancelled = await database.getFitnessRouteHeatmap({
          id: created.id
        })
        expect(cancelled?.status).toBe('cancelled')
      })
    })

    describe('share token', () => {
      it('sets, resolves, and clears a public share token', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all',
          region: 'rect:53.00,5.00,52.00,6.00'
        })

        // Fresh rows are private.
        expect(created.shareToken ?? null).toBeNull()

        const token = 'share-token-primary-abc'
        await expect(
          database.setFitnessRouteHeatmapShareToken({
            actorId: actors.primary.id,
            id: created.id,
            shareToken: token
          })
        ).resolves.toBe(true)

        const resolved = await database.getFitnessRouteHeatmapByShareToken({
          shareToken: token
        })
        expect(resolved?.id).toBe(created.id)
        expect(resolved?.shareToken).toBe(token)

        await expect(
          database.clearFitnessRouteHeatmapShareToken({
            actorId: actors.primary.id,
            id: created.id
          })
        ).resolves.toBe(true)

        await expect(
          database.getFitnessRouteHeatmapByShareToken({ shareToken: token })
        ).resolves.toBeNull()
      })

      it('resolves a token to the share scope without reading its geometry', async () => {
        // What the tile routes read. They answer from the pyramid and need only
        // the share's identity and scope, so a full-row read would drag the
        // entire untiled heatmap off disk once per tile batch — and a column
        // missing from the summary select is invisible to a mocked route test.
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2029',
          region: 'rect:63.00,5.00,62.00,6.00'
        })
        await database.updateFitnessRouteHeatmapStatus({
          id: created.id,
          status: 'completed',
          bounds: { minLat: 62, maxLat: 63, minLng: 5, maxLng: 6 },
          segments: [
            {
              points: [
                { lat: 62.1, lng: 5.2 },
                { lat: 62.2, lng: 5.3 }
              ]
            }
          ],
          activityCount: 1,
          pointCount: 2,
          isPartial: false
        })

        const token = 'share-token-summary-abc'
        await expect(
          database.setFitnessRouteHeatmapShareToken({
            actorId: actors.primary.id,
            id: created.id,
            shareToken: token
          })
        ).resolves.toBe(true)

        const summary =
          await database.getFitnessRouteHeatmapSummaryByShareToken({
            shareToken: token
          })

        // Every field the tile routes decide on, named individually: the gate
        // that refuses a scoped share reads activityType and periodType, the
        // clipping boundary reads region, and both are useless if the select
        // silently drops one.
        expect(summary).toMatchObject({
          id: created.id,
          actorId: actors.primary.id,
          activityType: 'running',
          periodType: 'yearly',
          periodKey: '2029',
          region: 'rect:63.00,5.00,62.00,6.00',
          status: 'completed',
          shareToken: token
        })
        // `parseSQLFitnessRouteHeatmapSummary` builds from an explicit field
        // list, so asserting the parsed object has no `segments` would hold for
        // ANY query shape — including `select('*')`. The half of this that the
        // tile routes actually depend on is the SQL, and it is pinned in its
        // own test below.
        expect('bounds' in (summary ?? {})).toBe(false)
        expect('segments' in (summary ?? {})).toBe(false)

        await expect(
          database.getFitnessRouteHeatmapSummaryByShareToken({
            shareToken: 'no-such-token'
          })
        ).resolves.toBeNull()
        await expect(
          database.getFitnessRouteHeatmapSummaryByShareToken({ shareToken: '' })
        ).resolves.toBeNull()

        // A soft-deleted heatmap's token stops resolving. This route is
        // unauthenticated, so the guard is what actually revokes a share when
        // the owner deletes the heatmap rather than un-sharing it.
        await expect(
          database.deleteFitnessRouteHeatmap({
            actorId: actors.primary.id,
            id: created.id
          })
        ).resolves.toBe(true)
        await expect(
          database.getFitnessRouteHeatmapSummaryByShareToken({
            shareToken: token
          })
        ).resolves.toBeNull()
      })

      it('does not overwrite an existing share token (concurrent-share guard)', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all',
          region: 'rect:33.00,5.00,32.00,6.00'
        })

        await expect(
          database.setFitnessRouteHeatmapShareToken({
            actorId: actors.primary.id,
            id: created.id,
            shareToken: 'first-token'
          })
        ).resolves.toBe(true)

        // A second set (e.g. a concurrent request) must not clobber the token.
        await expect(
          database.setFitnessRouteHeatmapShareToken({
            actorId: actors.primary.id,
            id: created.id,
            shareToken: 'second-token'
          })
        ).resolves.toBe(false)

        await expect(
          database.getFitnessRouteHeatmapByShareToken({
            shareToken: 'first-token'
          })
        ).resolves.not.toBeNull()
        await expect(
          database.getFitnessRouteHeatmapByShareToken({
            shareToken: 'second-token'
          })
        ).resolves.toBeNull()
      })

      it('scopes share-token mutations to the owning actor', async () => {
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.primary.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all',
          region: 'rect:43.00,5.00,42.00,6.00'
        })

        // A different actor cannot share another actor's heatmap.
        await expect(
          database.setFitnessRouteHeatmapShareToken({
            actorId: actors.replyAuthor.id,
            id: created.id,
            shareToken: 'share-token-wrong-owner'
          })
        ).resolves.toBe(false)
        await expect(
          database.getFitnessRouteHeatmapByShareToken({
            shareToken: 'share-token-wrong-owner'
          })
        ).resolves.toBeNull()
      })

      it('does not resolve a soft-deleted shared heatmap', async () => {
        const token = 'share-token-deleted-row'
        const created = await database.createFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          activityType: null,
          periodType: 'all_time',
          periodKey: 'all',
          region: 'rect:1.50,103.00,1.00,104.00'
        })
        await database.setFitnessRouteHeatmapShareToken({
          actorId: actors.replyAuthor.id,
          id: created.id,
          shareToken: token
        })

        await database.deleteFitnessRouteHeatmap({
          actorId: actors.replyAuthor.id,
          id: created.id
        })

        await expect(
          database.getFitnessRouteHeatmapByShareToken({ shareToken: token })
        ).resolves.toBeNull()
      })

      it('returns null for an empty share token', async () => {
        await expect(
          database.getFitnessRouteHeatmapByShareToken({ shareToken: '' })
        ).resolves.toBeNull()
      })
    })

    describe('getFitnessRouteHeatmapRegionNames / setFitnessRouteHeatmapRegionName', () => {
      const REGION = 'rect:50.00,4.00,49.00,5.00'

      it('returns an empty list when the actor has no saved region names', async () => {
        await expect(
          database.getFitnessRouteHeatmapRegionNames({
            actorId: actors.empty.id
          })
        ).resolves.toEqual([])
      })

      it('stores and retrieves a region name', async () => {
        await database.setFitnessRouteHeatmapRegionName({
          actorId: actors.primary.id,
          region: REGION,
          name: 'Veluwe loop'
        })

        const names = await database.getFitnessRouteHeatmapRegionNames({
          actorId: actors.primary.id
        })
        expect(names).toEqual(
          expect.arrayContaining([{ region: REGION, name: 'Veluwe loop' }])
        )
      })

      it('upserts the name for the same region instead of duplicating it', async () => {
        await database.setFitnessRouteHeatmapRegionName({
          actorId: actors.primary.id,
          region: REGION,
          name: 'First name'
        })
        await database.setFitnessRouteHeatmapRegionName({
          actorId: actors.primary.id,
          region: REGION,
          name: 'Second name'
        })

        const names = await database.getFitnessRouteHeatmapRegionNames({
          actorId: actors.primary.id
        })
        const matching = names.filter((entry) => entry.region === REGION)
        expect(matching).toEqual([{ region: REGION, name: 'Second name' }])
      })

      it('clears the stored name when set to null', async () => {
        await database.setFitnessRouteHeatmapRegionName({
          actorId: actors.primary.id,
          region: REGION,
          name: 'To be cleared'
        })
        await database.setFitnessRouteHeatmapRegionName({
          actorId: actors.primary.id,
          region: REGION,
          name: null
        })

        const names = await database.getFitnessRouteHeatmapRegionNames({
          actorId: actors.primary.id
        })
        expect(names.some((entry) => entry.region === REGION)).toBe(false)
      })

      it('scopes saved names to the owning actor', async () => {
        await database.setFitnessRouteHeatmapRegionName({
          actorId: actors.primary.id,
          region: 'rect:10.00,10.00,9.00,11.00',
          name: 'Primary only'
        })

        const otherActorNames =
          await database.getFitnessRouteHeatmapRegionNames({
            actorId: actors.replyAuthor.id
          })
        expect(
          otherActorNames.some((entry) => entry.name === 'Primary only')
        ).toBe(false)
      })
    })
    describe('pyramid subscribers', () => {
      // The scope one per-actor pyramid build covers: all activity types, all
      // time, any region.
      const subscriberScope = {
        activityType: null,
        periodType: 'all_time' as const,
        periodKey: 'all'
      }

      it('lists every in-flight all-time heatmap whatever its region', async () => {
        const actorId = actors.pollAuthor.id
        const world = await database.createFitnessRouteHeatmap({
          ...subscriberScope,
          actorId,
          region: ''
        })
        const singapore = await database.createFitnessRouteHeatmap({
          ...subscriberScope,
          actorId,
          region: 'rect:1.50,103.60,1.20,104.00'
        })

        const subscribers = await database.getFitnessRouteHeatmapSubscribers({
          actorId
        })
        expect(subscribers.map((row) => row.id).sort()).toEqual(
          [world.id, singapore.id].sort()
        )
      })

      it.each([
        {
          description: 'is scoped to a single activity type',
          overrides: { activityType: 'cycling' }
        },
        {
          description: 'is scoped to a single year',
          overrides: { periodType: 'yearly' as const, periodKey: '2026' }
        }
      ])('excludes a heatmap that $description', async ({ overrides }) => {
        const actorId = actors.extra.id
        await database.createFitnessRouteHeatmap({
          ...subscriberScope,
          ...overrides,
          actorId,
          region: ''
        })

        expect(
          await database.getFitnessRouteHeatmapSubscribers({ actorId })
        ).toEqual([])
      })

      it.each([
        { description: 'completed', status: 'completed' as const },
        { description: 'failed', status: 'failed' as const },
        { description: 'cancelled', status: 'cancelled' as const }
      ])('excludes a run that already $description', async ({ status }) => {
        const actorId = actors.followRequester.id
        const heatmap = await database.createFitnessRouteHeatmap({
          ...subscriberScope,
          actorId,
          region: `rect:2.00,3.00,1.00,4.00;terminal:${status}`
        })
        await database.updateFitnessRouteHeatmapStatus({
          id: heatmap.id,
          status
        })

        const subscribers = await database.getFitnessRouteHeatmapSubscribers({
          actorId
        })
        expect(subscribers.map((row) => row.id)).not.toContain(heatmap.id)
      })

      it('excludes a soft-deleted run and never mirrors progress onto it', async () => {
        const actorId = actors.primary.id
        const removed = await database.createFitnessRouteHeatmap({
          ...subscriberScope,
          actorId,
          region: 'rect:7.00,7.00,6.00,8.00'
        })
        await database.deleteFitnessRouteHeatmap({ actorId, id: removed.id })
        const live = await database.createFitnessRouteHeatmap({
          ...subscriberScope,
          actorId,
          region: 'rect:7.00,9.00,6.00,10.00'
        })

        const subscribers = await database.getFitnessRouteHeatmapSubscribers({
          actorId
        })
        expect(subscribers.map((row) => row.id)).toContain(live.id)
        expect(subscribers.map((row) => row.id)).not.toContain(removed.id)

        const mirrored =
          await database.mirrorFitnessRouteHeatmapGenerationProgress({
            actorId,
            totalCount: 99,
            cursorOffset: 33
          })

        // The deleted row cannot be read back to check it directly, so the
        // count is the assertion: the mirror touched the live subscribers and
        // nothing besides.
        expect(mirrored).toBe(subscribers.length)
        expect(
          (await database.getFitnessRouteHeatmap({ id: live.id }))?.totalCount
        ).toBe(99)
      })

      it('mirrors build progress onto every subscriber at once', async () => {
        const actorId = actors.empty.id
        const first = await database.createFitnessRouteHeatmap({
          ...subscriberScope,
          actorId,
          region: ''
        })
        const second = await database.createFitnessRouteHeatmap({
          ...subscriberScope,
          actorId,
          region: 'rect:52.60,4.60,52.00,5.20'
        })

        const mirrored =
          await database.mirrorFitnessRouteHeatmapGenerationProgress({
            actorId,
            totalCount: 400,
            cursorOffset: 175
          })

        expect(mirrored).toBe(2)
        for (const id of [first.id, second.id]) {
          const row = await database.getFitnessRouteHeatmap({ id })
          expect(row).toMatchObject({
            status: 'generating',
            totalCount: 400,
            cursorOffset: 175
          })
        }
      })

      it('does not drag a cancelled run back into generating', async () => {
        const actorId = actors.replyAuthor.id
        const cancelled = await database.createFitnessRouteHeatmap({
          ...subscriberScope,
          actorId,
          region: 'rect:9.00,9.00,8.00,10.00'
        })
        await database.cancelFitnessRouteHeatmapGeneration({
          actorId,
          id: cancelled.id
        })

        await database.mirrorFitnessRouteHeatmapGenerationProgress({
          actorId,
          totalCount: 10,
          cursorOffset: 5
        })

        const row = await database.getFitnessRouteHeatmap({ id: cancelled.id })
        expect(row?.status).toBe('cancelled')
        expect(row?.cursorOffset).toBe(0)
      })
    })
  })

  describe('share-token summary read SQL', () => {
    it('does not select the geometry columns', async () => {
      // The assertion the routes actually depend on. Checking the PARSED object
      // for a `segments` key proves nothing — the summary parser builds from an
      // explicit field list, so it would hold for `select('*')` too, and the
      // whole point of this read is that the query leaves the untiled heatmap
      // on disk rather than dragging it through JSON.parse once per tile batch.
      const { database, instance, prepare } = getTestDatabaseWithInstance(true)
      await prepare()
      await database.migrate()

      const statements: string[] = []
      const record = ({ sql }: { sql: string }) => {
        statements.push(sql)
      }
      instance.on('query', record)
      try {
        await database.getFitnessRouteHeatmapSummaryByShareToken({
          shareToken: 'no-such-token'
        })
      } finally {
        instance.removeListener('query', record)
      }

      expect(statements).toHaveLength(1)
      // Identifier quoting differs per backend (backticks on SQLite, double
      // quotes on PostgreSQL), so compare the bare names.
      const sql = statements[0].replaceAll('`', '').replaceAll('"', '')
      expect(sql).toContain('region')
      expect(sql).toContain('activityType')
      expect(sql).not.toContain('segments')
      expect(sql).not.toContain('bounds')
      expect(sql).not.toContain('*')

      await database.destroy()
    })
  })
})
