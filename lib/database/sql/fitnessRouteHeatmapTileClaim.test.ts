import {
  claimBuild,
  createActor,
  fence
} from '@/lib/database/sql/fitnessRouteHeatmapTileTestHelpers'
import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestDatabaseWithInstance
} from '@/lib/database/testUtils'

describe('FitnessRouteHeatmapTileDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    afterAll(async () => {
      await database.destroy()
    })

    describe('claimFitnessRouteHeatmapPyramidBuild', () => {
      it('creates the row and claims a fresh build on first use', async () => {
        const actorId = await createActor(database)

        const claim = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })

        expect(claim.claimed).toBe(true)
        expect(claim.resumed).toBe(false)
        expect(claim.reason).toBe('claimed')
        expect(claim.pyramid.status).toBe('generating')
        // A fresh claim bumps the version so its tiles replace, not extend,
        // whatever an earlier build left behind.
        expect(claim.pyramid.version).toBe(1)
        expect(claim.pyramid.cursor).toBeUndefined()
      })

      it('refuses a second claim while a build is heartbeating', async () => {
        const actorId = await createActor(database)
        const staleBefore = Date.now() - 120_000

        await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore
        })
        const second = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore
        })

        expect(second.claimed).toBe(false)
        expect(second.reason).toBe('build-in-progress')
        expect(second.pyramid.version).toBe(1)
      })

      it('does not steal a build whose owner heartbeats after the staleness read', async () => {
        // The interleaving the ownership token alone cannot catch, staged for
        // real: a claimer reads a row whose heartbeat has expired, and before
        // its compare-and-swap lands the owner checkpoints — refreshing
        // `updatedAt` but not `claimSeq`, because a checkpoint never touches
        // the token. Guarded on the token alone the CAS would still match and
        // hand this claimer a demonstrably live build, so the JS verdict has
        // to be re-asserted by the write.
        //
        // The heartbeat fires from the claim's own read, which IS that window.
        // Without it the row is fresh at read time, the JS classifier answers
        // `build-in-progress` and returns before issuing any statement — so
        // the guard this test is named for would never run.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
        await isolated.migrate()

        try {
          const actorId = await createActor(isolated)
          const owner = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          expect(owner.claimed).toBe(true)

          // Backdated so the row genuinely reads as abandoned. Written to the
          // column directly: every mixin write refreshes `updatedAt`, which is
          // the whole point of it as a heartbeat.
          await instance('fitness_route_heatmap_pyramids')
            .where('actorId', actorId)
            .update({ updatedAt: new Date(Date.now() - 600_000) })

          let heartbeated = false
          const heartbeatOnRead = async ({ sql }: { sql: string }) => {
            if (
              heartbeated ||
              !sql.trimStart().toLowerCase().startsWith('select') ||
              !sql.includes('fitness_route_heatmap_pyramids')
            ) {
              return
            }
            heartbeated = true
            await instance('fitness_route_heatmap_pyramids')
              .where('actorId', actorId)
              .update({ updatedAt: new Date() })
          }
          instance.on('query-response', (_response, query) => {
            void heartbeatOnRead(query)
          })

          const thief = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })

          // The read said claimable; the write disagreed, which is the guard
          // doing its job.
          expect(heartbeated).toBe(true)
          expect(thief.claimed).toBe(false)

          // The owner still owns it, so its writes are still accepted.
          expect(
            await isolated.updateFitnessRouteHeatmapPyramid({
              actorId,
              ...fence(owner.pyramid),
              scannedCount: 6
            })
          ).toBe(true)
        } finally {
          await isolated.destroy()
        }
      })

      it.each([
        { description: 'exactly at the staleness boundary', offset: 0 },
        { description: 'one millisecond inside it', offset: 1 }
      ])(
        'refuses a build whose heartbeat is $description',
        async ({ offset }) => {
          // `updatedAt >= staleBefore` is live. The boundary itself is the case
          // a `>=` relaxed to `>` gets wrong, and it is not exotic: the
          // heartbeat and the claim's own clock are both `Date.now()`, and two
          // operations in one millisecond is what an earlier flake in this
          // suite was made of. Both sides of the module have to agree on it or
          // the claim answers `lost-race` forever.
          const actorId = await createActor(database)
          const owner = await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          expect(owner.claimed).toBe(true)

          const heartbeat = (
            await database.getFitnessRouteHeatmapPyramid({ actorId })
          )?.updatedAt
          expect(heartbeat).toBeDefined()

          const thief = await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: heartbeat! - offset
          })

          expect({ claimed: thief.claimed, reason: thief.reason }).toEqual({
            claimed: false,
            reason: 'build-in-progress'
          })
        }
      )

      it('reclaims a build whose heartbeat is one millisecond past the boundary', async () => {
        // The other side of the same boundary — without this the pair pins
        // nothing, because "always refuse" satisfies the two cases above.
        const actorId = await createActor(database)
        const owner = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        const heartbeat = (
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        )?.updatedAt

        expect(
          await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: heartbeat! + 1
          })
        ).toMatchObject({
          claimed: true,
          reason: 'claimed',
          pyramid: { claimSeq: owner.pyramid.claimSeq + 1 }
        })
      })

      it('does not discard a build that completed while the claim was being decided', async () => {
        const actorId = await createActor(database)
        const owner = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now() - 1_000,
          staleBefore: Date.now() - 120_000
        })
        const completedAt = Date.now()
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(owner.pyramid),
          status: 'completed',
          completedAt,
          tileCount: 42
        })

        // A request the finished build already satisfies. Guarded on the token
        // alone this would have reset the row to `generating`, bumped the
        // version out from under the tiles on disk and rebuilt from scratch.
        const later = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: completedAt,
          staleBefore: Date.now() - 120_000
        })

        expect(later.claimed).toBe(false)
        expect(later.reason).toBe('already-fresh')

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId
        })
        expect(pyramid).toMatchObject({
          status: 'completed',
          version: owner.pyramid.version,
          tileCount: 42
        })
        expect(pyramid?.completedAt).toBe(completedAt)
      })

      it('reads an epoch-0 cursor the same way on both backends', async () => {
        // The same trap as `completedAt`, on the columns the resume premise is
        // built from: an epoch-0 `cursorCreatedAt` is a falsy integer on SQLite
        // and a truthy Date on PostgreSQL, so read with truthiness the same row
        // would be resumable on one backend and not the other — and a row whose
        // JS verdict and SQL predicate disagree can never be claimed at all.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
        await isolated.migrate()

        try {
          const actorId = await createActor(isolated)
          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          // Written straight to the columns: the mixin's own writer would take
          // an epoch-0 cursor as a legitimate value either way, and the point
          // is what the READER makes of the stored row.
          await instance('fitness_route_heatmap_pyramids')
            .where('actorId', actorId)
            .update({ cursorCreatedAt: new Date(0), cursorId: 'activity-0' })

          expect(
            await isolated.getFitnessRouteHeatmapPyramid({ actorId })
          ).toMatchObject({ cursor: { createdAt: 0, id: 'activity-0' } })

          // And it is a real cursor, so this build's own continuation resumes.
          expect(
            await isolated.claimFitnessRouteHeatmapPyramidBuild({
              actorId,
              requestedAt: Date.now(),
              staleBefore: Date.now() - 120_000,
              resumeBuild: fence(claim.pyramid)
            })
          ).toMatchObject({ claimed: true, resumed: true })
        } finally {
          await isolated.destroy()
        }
      })

      it('clears the previous completion when it starts a fresh build', async () => {
        // A fresh claim nulls `completedAt` in the same statement that stamps
        // `generating`. Left behind, the row would carry a completion time from
        // a build whose tiles the new version is about to replace — and that
        // column is what `already-fresh` reads, so the next request would be
        // served from a pyramid that no longer exists.
        const actorId = await createActor(database)
        const first = await claimBuild(database, actorId)
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(first),
          status: 'completed',
          completedAt: Date.now() - 10_000,
          tileCount: 12
        })

        const rebuild = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })

        expect(rebuild).toMatchObject({ claimed: true, resumed: false })
        expect(rebuild.pyramid.completedAt).toBeUndefined()
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        ).toMatchObject({ status: 'generating', completedAt: undefined })
      })

      it('reads an epoch-0 completion the same way on both backends', async () => {
        // The same per-backend truthiness trap the cursor columns carry, on the
        // field that decides `already-fresh`: an epoch-0 timestamp comes back a
        // falsy integer on SQLite and a truthy Date on PostgreSQL, so read with
        // truthiness the same row answers differently depending on where it is
        // stored. Reachable or not, a JS/SQL split here is the wedge class this
        // whole mixin is written around.
        const { database: isolated, prepare: prepareIsolated } =
          getTestDatabaseWithInstance(true)
        await prepareIsolated()
        await isolated.migrate()

        try {
          const actorId = await createActor(isolated)
          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          await isolated.updateFitnessRouteHeatmapPyramid({
            actorId,
            ...fence(claim.pyramid),
            status: 'completed',
            completedAt: 0
          })

          expect(
            await isolated.getFitnessRouteHeatmapPyramid({ actorId })
          ).toMatchObject({ status: 'completed', completedAt: 0 })

          // And the claim treats it as the ancient completion it is, rather
          // than as one that never happened.
          expect(
            await isolated.claimFitnessRouteHeatmapPyramidBuild({
              actorId,
              requestedAt: Date.now(),
              staleBefore: Date.now() - 120_000
            })
          ).toMatchObject({ claimed: true, reason: 'claimed' })
        } finally {
          await isolated.destroy()
        }
      })

      it('claims a build whose owner completed it without stamping a time', async () => {
        // `completedAt` is nullable, and the claimable predicate is written as
        // a De Morgan expansion precisely so this row stays takeable: the
        // naive `NOT (status = 'completed' AND completedAt >= ?)` is NULL here,
        // which SQL treats as not-matching and would wedge the actor's
        // pyramid permanently.
        const actorId = await createActor(database)
        const owner = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(owner.pyramid),
          status: 'completed',
          completedAt: null
        })

        const next = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })

        expect(next.claimed).toBe(true)
        expect(next.reason).toBe('claimed')
      })

      it('claims an abandoned failed build as a fresh version with its progress reset', async () => {
        // A build that failed is takeable, and takeable as a FRESH one: new
        // version, no cursor, and this run's counters back to zero — which is
        // what stops it rescanning into the abandoned pass's own tiles.
        //
        // Named for what it pins and no more. `status` decides `resumed` on
        // its own, short-circuiting before the cursor is read, so this says
        // nothing about the cursor half of the premise however the cursor is
        // left; `starts a fresh version when an abandoned build never
        // checkpointed` covers that, and the compare-and-swap carrying the
        // premise into the write at all is pinned structurally below.
        const actorId = await createActor(database)
        const owner = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(owner.pyramid),
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' },
          scannedCount: 500
        })
        // Cursor deliberately LEFT in place: a failed build is not resumable
        // whatever it holds, and clearing it here would suggest the cursor was
        // doing the work.
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(owner.pyramid),
          status: 'failed',
          error: 'worker died'
        })

        const claim = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000
        })

        expect(claim.claimed).toBe(true)
        expect(claim.resumed).toBe(false)
        expect(claim.pyramid.version).toBe(owner.pyramid.version + 1)
        expect(claim.pyramid.cursor).toBeUndefined()
        expect(claim.pyramid.scannedCount).toBe(0)
      })

      it('recreates the build row when a clear removes it mid-claim', async () => {
        // The insert that precedes the claim's read holds no lock on the row it
        // conflicts with, so clearing an actor's heatmaps can delete it in
        // between. The barrier below stages that interleaving after the insert
        // has completed and before the claim's first read.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
        await isolated.migrate()

        let originalQuery: typeof instance.client.query | undefined
        let clearListener: ((query: { sql: string }) => void) | undefined

        try {
          const actorId = await createActor(isolated)
          // The query event fires before the driver runs the INSERT. Mark that
          // statement here, then the client-query wrapper below runs the clear
          // after the INSERT resolves and before the claim's await continues.
          // Keeping both statements on the same connection makes the intended
          // interleaving independent of pool scheduling on PostgreSQL.
          let cleared = false
          let clearPending = false
          let insertAttempts = 0
          const clearAfterFirstInsert = ({ sql }: { sql: string }) => {
            const normalizedSql = sql.trimStart().toLowerCase()
            if (
              !normalizedSql.startsWith('insert') ||
              !normalizedSql.includes('fitness_route_heatmap_pyramids')
            ) {
              return
            }
            insertAttempts += 1
            if (cleared || clearPending) return
            clearPending = true
          }

          const queryMethod = instance.client.query
          originalQuery = queryMethod
          const runOriginalQuery = queryMethod.bind(instance.client)
          instance.client.query = async (
            connection: Parameters<typeof queryMethod>[0],
            query: Parameters<typeof queryMethod>[1]
          ) => {
            const response = await runOriginalQuery(connection, query)

            if (clearPending && !cleared) {
              clearPending = false
              cleared = true
              await runOriginalQuery(
                connection,
                instance('fitness_route_heatmap_pyramids')
                  .where('actorId', actorId)
                  .delete()
                  .toSQL()
              )
            }

            return response
          }

          // Hook 'query' (when INSERT is sent) rather than 'query-response'
          // (when INSERT resolves) so the barrier above can serialize the
          // DELETE after the INSERT and before attempt 1's readPyramidRow.
          clearListener = clearAfterFirstInsert
          instance.on('query', clearAfterFirstInsert)

          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })

          // Answered rather than thrown: the row was cleared, and a claim
          // arriving after a clear should build.
          expect(cleared).toBe(true)
          expect(insertAttempts).toBe(2)
          expect(claim.claimed).toBe(true)
          expect(claim.reason).toBe('claimed')
        } finally {
          if (clearListener) instance.off('query', clearListener)
          if (originalQuery) instance.client.query = originalQuery
          await isolated.destroy()
        }
      })

      it('never treats a half-written cursor as resumable on one side only', async () => {
        // JS and SQL have to agree about what a cursor IS. Where they disagree
        // the claim's own write can never match its own decision, and the
        // actor's pyramid is wedged for good: every attempt answers
        // `lost-race`, and clearing the cursor needs a token nobody holds.
        // Truthiness disagreed on exactly these rows — an epoch-0 timestamp is
        // a falsy integer on SQLite and a truthy Date on PostgreSQL, and an
        // empty id is falsy in JS but not NULL in SQL.
        //
        // Written straight to the columns, because `updateFitnessRouteHeatmapPyramid`
        // can only ever set both or neither. That a half cursor is unreachable
        // through the mixin is not the point: nothing stops one existing, and a
        // permanent wedge is not an acceptable response to one.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
        await isolated.migrate()

        try {
          const halfCursors = [
            { cursorCreatedAt: null, cursorId: 'activity-1' },
            { cursorCreatedAt: new Date(0), cursorId: 'activity-1' },
            { cursorCreatedAt: new Date(1_700_000_000_000), cursorId: '' },
            { cursorCreatedAt: new Date(1_700_000_000_000), cursorId: null }
          ]

          for (const halfCursor of halfCursors) {
            const actorId = await createActor(isolated)
            await isolated.claimFitnessRouteHeatmapPyramidBuild({
              actorId,
              requestedAt: Date.now(),
              staleBefore: Date.now() - 120_000
            })
            await instance('fitness_route_heatmap_pyramids')
              .where('actorId', actorId)
              .update(halfCursor)

            const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
              actorId,
              requestedAt: Date.now(),
              staleBefore: Date.now() + 60_000
            })

            // Labelled by the row under test, so a failure names which one.
            expect({
              cursorCreatedAt: halfCursor.cursorCreatedAt,
              cursorId: halfCursor.cursorId,
              claimed: claim.claimed,
              reason: claim.reason
            }).toEqual({
              cursorCreatedAt: halfCursor.cursorCreatedAt,
              cursorId: halfCursor.cursorId,
              claimed: true,
              reason: 'claimed'
            })
          }
        } finally {
          await isolated.destroy()
        }
      })

      it('resumes an abandoned build without losing its version or cursor', async () => {
        const actorId = await createActor(database)
        const first = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(first.pyramid),
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' },
          scannedCount: 17
        })

        // The worker dies; a later pass that IS continuing the same scan finds
        // the heartbeat long expired.
        const resumed = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000,
          resumeBuild: fence(first.pyramid)
        })

        expect(resumed.claimed).toBe(true)
        expect(resumed.reason).toBe('claimed')
        expect(resumed.resumed).toBe(true)
        // Same version: the tiles the dead pass already wrote stay valid and
        // are added to rather than replaced.
        expect(resumed.pyramid.version).toBe(first.pyramid.version)
        expect(resumed.pyramid.cursor).toEqual({
          createdAt: 1_700_000_000_000,
          id: 'activity-42'
        })
        expect(resumed.pyramid.scannedCount).toBe(17)
      })

      it('lets a continuation carrying the live token re-adopt its own build', async () => {
        // Flushing IS the heartbeat, so the pass that just checkpointed leaves
        // a `generating` row with a fresh `updatedAt`. Without the token its
        // own continuation reads that as somebody else's live build and backs
        // off, and no build could ever outlive one checkpoint.
        const actorId = await createActor(database)
        const first = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(first.pyramid),
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' },
          scannedCount: 17
        })

        const continuation =
          await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            // Heartbeat well inside the window: without the token this is
            // exactly the `build-in-progress` case.
            staleBefore: Date.now() - 120_000,
            resumeBuild: fence(first.pyramid)
          })

        expect(continuation.claimed).toBe(true)
        expect(continuation.resumed).toBe(true)
        expect(continuation.pyramid.version).toBe(first.pyramid.version)
        expect(continuation.pyramid.scannedCount).toBe(17)
        // The token still moves, which is what fences the pass it replaces.
        expect(continuation.pyramid.claimSeq).toBe(first.pyramid.claimSeq + 1)
      })

      it('gives a continuation delivered twice exactly one winner', async () => {
        const actorId = await createActor(database)
        const first = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(first.pyramid),
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' },
          scannedCount: 17
        })

        const claimOnce = () =>
          database.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000,
            resumeBuild: fence(first.pyramid)
          })

        const winner = await claimOnce()
        const duplicate = await claimOnce()

        expect(winner.claimed).toBe(true)
        // The redelivery presents a token that has already advanced, so it is
        // refused rather than folding the same activities in a second time.
        expect(duplicate.claimed).toBe(false)
        // Refused because the winner is now heartbeating on an advanced token,
        // which reclassifies as a live build rather than a bare lost race.
        expect(duplicate.reason).toBe('build-in-progress')
      })

      it('refuses a token minted for a build that a clear has since removed', async () => {
        // `claimSeq` counts from zero per ROW, and clearing an actor's heatmaps
        // deletes the row — so the first claim before a clear and the first
        // claim after it both hold token 1. Matching on the token alone let a
        // continuation stranded across a clear evict the live build that had
        // replaced it, and the collision lands on the likeliest value there is.
        const actorId = await createActor(database)
        const stranded = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(stranded.pyramid),
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' },
          scannedCount: 17
        })

        await database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
          actorId
        })

        // The replacement build starts its own sequence from zero and is live.
        const live = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        expect(live.claimed).toBe(true)
        expect(live.pyramid.claimSeq).toBe(stranded.pyramid.claimSeq)
        expect(live.pyramid.id).not.toBe(stranded.pyramid.id)

        const late = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000,
          resumeBuild: fence(stranded.pyramid)
        })

        expect(late.claimed).toBe(false)
        expect(late.reason).toBe('build-in-progress')
        // And the live build still owns itself, so its next flush lands.
        expect(
          await database.updateFitnessRouteHeatmapPyramid({
            actorId,
            ...fence(live.pyramid),
            scannedCount: 1
          })
        ).toBe(true)
      })

      it('does not let a stale token reopen a build another worker has taken', async () => {
        const actorId = await createActor(database)
        const first = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(first.pyramid),
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' },
          scannedCount: 17
        })
        // Somebody else reclaims it as abandoned and is now heartbeating.
        const takeover = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000
        })
        expect(takeover.claimed).toBe(true)

        const late = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000,
          resumeBuild: fence(first.pyramid)
        })

        expect(late.claimed).toBe(false)
        expect(late.reason).toBe('build-in-progress')
      })

      it('starts a fresh version when an abandoned build never checkpointed', async () => {
        const actorId = await createActor(database)
        await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })

        const reclaimed = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000
        })

        expect(reclaimed.claimed).toBe(true)
        expect(reclaimed.resumed).toBe(false)
        expect(reclaimed.pyramid.version).toBe(2)
      })

      it('skips the build when a completed pyramid already answers the request', async () => {
        const actorId = await createActor(database)
        const claim = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        const completedAt = Date.now()
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(claim.pyramid),
          status: 'completed',
          completedAt
        })

        const later = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          // Asked for before the pyramid finished, so it is already covered.
          requestedAt: completedAt - 1_000,
          staleBefore: Date.now() - 120_000
        })

        expect(later.claimed).toBe(false)
        expect(later.reason).toBe('already-fresh')
        expect(later.pyramid.version).toBe(claim.pyramid.version)
      })

      it('rebuilds when the request is newer than the completed pyramid', async () => {
        const actorId = await createActor(database)
        const claim = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        const completedAt = Date.now()
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(claim.pyramid),
          status: 'completed',
          completedAt
        })

        const later = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: completedAt + 1_000,
          staleBefore: Date.now() - 120_000
        })

        expect(later.claimed).toBe(true)
        expect(later.reason).toBe('claimed')
        expect(later.pyramid.version).toBe(claim.pyramid.version + 1)
      })

      it.each([
        {
          description: 'a fresh build',
          seedCursor: false
        },
        {
          description: 'a resumable build',
          seedCursor: true
        }
      ])(
        'refuses a claim whose build was taken over between its read and its write, over $description',
        async ({ seedCursor }) => {
          // The compare-and-swap itself: a claimer that decided on one state
          // and writes against another must lose.
          //
          // Staged with a listener rather than by racing two real claims
          // through `Promise.all`. That only produces the read-read-write-write
          // interleaving on SQLite's single-connection pool; on PostgreSQL the
          // first claim routinely finishes before the second one reads, and
          // there a second winner is CORRECT — a far-future `staleBefore` makes
          // the just-claimed build look abandoned, so taking it over is the
          // documented behaviour, not a bug. Asserting exactly-one-winner
          // against that was flaky (~2/5 on pg) and only ever passed on SQLite
          // by pool timing.
          //
          // The resumable row is the case that used to hand BOTH workers the
          // build, because a resume leaves `version` untouched — which is why
          // the fence is `claimSeq` and why it is worth pinning per shape.
          const {
            database: isolated,
            instance,
            prepare: prepareIsolated
          } = getTestDatabaseWithInstance(true)
          await prepareIsolated()
          await isolated.migrate()

          try {
            const actorId = await createActor(isolated)
            if (seedCursor) {
              const seeding =
                await isolated.claimFitnessRouteHeatmapPyramidBuild({
                  actorId,
                  requestedAt: Date.now(),
                  staleBefore: Date.now() - 120_000
                })
              await isolated.updateFitnessRouteHeatmapPyramid({
                actorId,
                ...fence(seeding.pyramid),
                cursor: { createdAt: 1_700_000_000_000, id: 'activity-9' }
              })
            }

            // Attached only now, so the seeding claim above does not trip it.
            // Fires once, on the claim's read — the exact window the guard
            // exists for — and bumps the token the way a competing worker
            // winning the race would.
            let stolen = false
            const stealOnFirstRead = async ({ sql }: { sql: string }) => {
              if (
                stolen ||
                !sql.trimStart().toLowerCase().startsWith('select') ||
                !sql.includes('fitness_route_heatmap_pyramids')
              ) {
                return
              }
              stolen = true
              await instance('fitness_route_heatmap_pyramids')
                .where('actorId', actorId)
                .increment('claimSeq', 1)
            }
            instance.on('query-response', (_response, query) => {
              void stealOnFirstRead(query)
            })

            const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
              actorId,
              requestedAt: Date.now(),
              // Far future, so the row never reads as a live build and only
              // the token can turn this claim away.
              staleBefore: Date.now() + 60_000
            })

            expect(stolen).toBe(true)
            expect(claim.claimed).toBe(false)
            expect(claim.reason).toBe('lost-race')
          } finally {
            await isolated.destroy()
          }
        }
      )

      it.each([
        { description: 'a failed build', status: 'failed' as const },
        { description: 'a cancelled build', status: 'cancelled' as const }
      ])('claims a fresh version over $description', async ({ status }) => {
        const actorId = await createActor(database)
        const claim = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(claim.pyramid),
          status
        })

        const next = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })

        expect(next.claimed).toBe(true)
        expect(next.pyramid.version).toBe(claim.pyramid.version + 1)
      })
    })
  })
})
