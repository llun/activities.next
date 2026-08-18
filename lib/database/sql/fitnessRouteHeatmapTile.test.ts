import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestSQLDatabaseWithInstance
} from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'

describe('FitnessRouteHeatmapTileDatabase', () => {
  const table = getTestDatabaseTable()

  beforeAll(async () => {
    await databaseBeforeAll(table)
  })

  describe.each(table)('%s', (_, database) => {
    afterAll(async () => {
      await database.destroy()
    })

    // The pyramid is keyed one-per-actor and the tile assertions are exact
    // counts and sums, so every test gets an actor nothing else touches
    // rather than sharing one of the seeded ones.
    let actorSequence = 0
    const createActor = async (db: Database) => {
      actorSequence += 1
      const username = `tile-actor-${actorSequence}`
      const actorId = `https://llun.test/users/${username}`
      await db.createActor({
        actorId,
        username,
        domain: 'llun.test',
        inboxUrl: `${actorId}/inbox`,
        outboxUrl: `${actorId}/outbox`,
        followersUrl: `${actorId}/followers`,
        sharedInboxUrl: 'https://llun.test/inbox',
        publicKey: `public-key-${username}`,
        privateKey: `private-key-${username}`,
        createdAt: Date.now()
      })
      return actorId
    }

    // Tile writes are fenced on the build's ownership token, so a test that
    // wants to write tiles has to own a build first.
    const claimBuild = async (db: Database, actorId: string) => {
      const claim = await db.claimFitnessRouteHeatmapPyramidBuild({
        actorId,
        requestedAt: Date.now(),
        staleBefore: Date.now() - 120_000
      })
      expect(claim.claimed).toBe(true)
      return claim.pyramid.claimSeq
    }

    const tile = (tileKey: string, pointCount = 4) => {
      const [z, x, y] = tileKey.split(':').map(Number)
      return {
        tileKey,
        z,
        x,
        y,
        segments: `{"e":256,"s":[{"c":1,"p":[0,0,8,8]}],"k":"${tileKey}"}`,
        pointCount
      }
    }

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
        // The interleaving the ownership token alone cannot catch. A claimer
        // reads a row whose heartbeat has expired, and before its
        // compare-and-swap lands the owner checkpoints — refreshing
        // `updatedAt` but not `claimSeq`, because a checkpoint never touches
        // the token. Guarded on the token alone, the CAS would still match and
        // hand this claimer a demonstrably live build.
        const actorId = await createActor(database)
        const owner = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })

        // Stands in for the claimer's read having happened before the owner's
        // checkpoint: `staleBefore` in the future makes the row look expired at
        // read time, and the checkpoint below is what happens next.
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          claimSeq: owner.pyramid.claimSeq,
          scannedCount: 5
        })

        const thief = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })

        expect(thief.claimed).toBe(false)
        expect(thief.reason).toBe('build-in-progress')

        // The owner still owns it, so its writes are still accepted.
        expect(
          await database.updateFitnessRouteHeatmapPyramid({
            actorId,
            claimSeq: owner.pyramid.claimSeq,
            scannedCount: 6
          })
        ).toBe(true)
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
          claimSeq: owner.pyramid.claimSeq,
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
          claimSeq: owner.pyramid.claimSeq,
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
          claimSeq: owner.pyramid.claimSeq,
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' },
          scannedCount: 500
        })
        // Cursor deliberately LEFT in place: a failed build is not resumable
        // whatever it holds, and clearing it here would suggest the cursor was
        // doing the work.
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          claimSeq: owner.pyramid.claimSeq,
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
        // between. Staged by clearing on the read itself, which is that window.
        const { database: isolated, instance } =
          getTestSQLDatabaseWithInstance()
        await isolated.migrate()

        try {
          const actorId = await createActor(isolated)
          // Fires once, on the claim's first INSERT — so the row is gone by
          // the time that attempt reads it back, which is the window the retry
          // exists for. Clearing any later would stage a different race.
          let cleared = false
          const clearAfterFirstInsert = async ({ sql }: { sql: string }) => {
            if (
              cleared ||
              !sql.trimStart().toLowerCase().startsWith('insert') ||
              !sql.includes('fitness_route_heatmap_pyramids')
            ) {
              return
            }
            cleared = true
            await instance('fitness_route_heatmap_pyramids')
              .where('actorId', actorId)
              .delete()
          }
          instance.on('query-response', (_response, query) => {
            void clearAfterFirstInsert(query)
          })

          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })

          // Answered rather than thrown: the row was cleared, and a claim
          // arriving after a clear should build.
          expect(claim.claimed).toBe(true)
          expect(claim.reason).toBe('claimed')
        } finally {
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
        const { database: isolated, instance } =
          getTestSQLDatabaseWithInstance()
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

      it('carries the claim decision into the compare-and-swap itself', async () => {
        // Asserted on the statement issued rather than on an outcome, because
        // the interleaving this guards against — the owner heartbeating or
        // completing between this claim's read and its write — cannot be
        // staged deterministically from a single-threaded test. What can be
        // pinned is that the UPDATE re-tests the state the decision was made
        // on instead of trusting the token alone; without that clause the
        // read's verdict is a snapshot the write never rechecks.
        const { database: isolated, instance } =
          getTestSQLDatabaseWithInstance()
        await isolated.migrate()
        try {
          const actorId = await createActor(isolated)
          const updates: string[] = []
          instance.on('query', ({ sql }: { sql: string }) => {
            if (
              sql.includes('fitness_route_heatmap_pyramids') &&
              sql.trimStart().toLowerCase().startsWith('update')
            ) {
              updates.push(sql)
            }
          })

          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          expect(claim.claimed).toBe(true)

          expect(updates).toHaveLength(1)
          // Only the WHERE half. The SET half writes `status`, `updatedAt` and
          // `completedAt` on every fresh claim, so asserting against the whole
          // statement would pass with no guard at all.
          const [cas] = updates
          const whereClause = cas.slice(cas.toLowerCase().indexOf(' where '))

          expect(whereClause).toContain('claimSeq')
          // The two halves of "not already fresh, and not still running".
          expect(whereClause).toContain('completedAt')
          expect(whereClause).toContain('updatedAt')
          expect(whereClause).toContain('status')
          // And the resume premise. A verdict of "claimable" is satisfied by
          // every terminal status alike, so re-asserting it says nothing about
          // whether this claim's `resumed`/`version` decision still holds.
          expect(whereClause).toContain('cursorId')

          // Same for a claim that decided to RESUME, where the premise is the
          // mirror image: still generating, still holding a cursor.
          updates.length = 0
          await isolated.updateFitnessRouteHeatmapPyramid({
            actorId,
            claimSeq: claim.pyramid.claimSeq,
            cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' }
          })
          updates.length = 0

          const resumedClaim =
            await isolated.claimFitnessRouteHeatmapPyramidBuild({
              actorId,
              requestedAt: Date.now(),
              staleBefore: Date.now() + 60_000
            })
          expect(resumedClaim.resumed).toBe(true)

          expect(updates).toHaveLength(1)
          const resumedWhere = updates[0].slice(
            updates[0].toLowerCase().indexOf(' where ')
          )
          expect(resumedWhere).toContain('cursorId')
          expect(resumedWhere).toContain('status')
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
          claimSeq: first.pyramid.claimSeq,
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' },
          scannedCount: 17
        })

        // The worker dies; a later pass finds the heartbeat long expired.
        const resumed = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000
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
          claimSeq: claim.pyramid.claimSeq,
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
          claimSeq: claim.pyramid.claimSeq,
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
          const { database: isolated, instance } =
            getTestSQLDatabaseWithInstance()
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
                claimSeq: seeding.pyramid.claimSeq,
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
          claimSeq: claim.pyramid.claimSeq,
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

    describe('updateFitnessRouteHeatmapPyramid', () => {
      it('writes progress, cursor and terminal state under the owned version', async () => {
        const actorId = await createActor(database)
        const claim = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })

        const applied = await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          claimSeq: claim.pyramid.claimSeq,
          totalCount: 200,
          scannedCount: 100,
          activityCount: 90,
          tileCount: 1_234,
          pointCount: 56_789,
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-100' }
        })

        expect(applied).toBe(true)
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId
        })
        expect(pyramid).toMatchObject({
          totalCount: 200,
          scannedCount: 100,
          activityCount: 90,
          tileCount: 1_234,
          pointCount: 56_789,
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-100' }
        })
      })

      it('rejects a write from a pass whose build was superseded', async () => {
        const actorId = await createActor(database)
        const first = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        // A reclaim takes the build over with a new version.
        const second = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000
        })
        expect(second.pyramid.version).toBe(first.pyramid.version + 1)

        const applied = await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          claimSeq: first.pyramid.claimSeq,
          scannedCount: 999
        })

        expect(applied).toBe(false)
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId
        })
        expect(pyramid?.scannedCount).toBe(0)
      })

      it('fences a presumed-dead pass whose build was RESUMED by another worker', async () => {
        // The case a version-guarded write cannot catch: a resume keeps the
        // build's version, so only the separate claim token distinguishes the
        // new owner from the pass it took over. Without it the zombie's write
        // lands, rewinding the cursor and marking a half-built pyramid
        // 'completed' — after which every later claim sees it as already fresh.
        const actorId = await createActor(database)
        const dying = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          claimSeq: dying.pyramid.claimSeq,
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-50' },
          scannedCount: 50
        })

        const reclaimer = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000
        })
        expect(reclaimer.resumed).toBe(true)
        // Same tile generation, so the interrupted pass's tiles survive...
        expect(reclaimer.pyramid.version).toBe(dying.pyramid.version)
        // ...but a new owner.
        expect(reclaimer.pyramid.claimSeq).toBe(dying.pyramid.claimSeq + 1)

        const zombieWrite = await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          claimSeq: dying.pyramid.claimSeq,
          status: 'completed',
          completedAt: Date.now(),
          cursor: { createdAt: 1_600_000_000_000, id: 'activity-10' }
        })

        expect(zombieWrite).toBe(false)
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId
        })
        expect(pyramid?.status).toBe('generating')
        expect(pyramid?.completedAt).toBeUndefined()
        expect(pyramid?.cursor).toEqual({
          createdAt: 1_700_000_000_000,
          id: 'activity-50'
        })
      })

      it('clears the cursor when passed null', async () => {
        const actorId = await createActor(database)
        const claim = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          claimSeq: claim.pyramid.claimSeq,
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-7' }
        })

        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          claimSeq: claim.pyramid.claimSeq,
          cursor: null
        })

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId
        })
        expect(pyramid?.cursor).toBeUndefined()
      })
    })

    describe('getFitnessRouteHeatmapPyramid', () => {
      it('returns null for an actor that has never generated one', async () => {
        const actorId = await createActor(database)
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        ).toBeNull()
      })
    })

    describe('upsertFitnessRouteHeatmapTiles and reads', () => {
      it('writes tiles and reads them back by key', async () => {
        const actorId = await createActor(database)
        const claimSeq = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 1,
          tiles: [tile('16:100:200', 6), tile('16:101:200', 4)]
        })

        const tiles = await database.getFitnessRouteHeatmapTilesByKeys({
          actorId,
          tileKeys: ['16:100:200', '16:101:200', '16:999:999']
        })

        expect(tiles).toHaveLength(2)
        expect(tiles.map((row) => row.tileKey).sort()).toEqual([
          '16:100:200',
          '16:101:200'
        ])
        const first = tiles.find((row) => row.tileKey === '16:100:200')
        expect(first).toMatchObject({
          z: 16,
          x: 100,
          y: 200,
          version: 1,
          pointCount: 6
        })
        // The payload is handed back exactly as stored: the serving path
        // forwards it without decoding.
        expect(first?.segments).toBe(tile('16:100:200').segments)
      })

      it('rejects a flush from a pass whose build was taken over', async () => {
        // The zombie case, and the reason the flush is fenced at all. A pass
        // presumed dead is superseded, but its in-flight batch keeps going. On
        // a RESUMED build the successor kept the same version, so the zombie's
        // write would stamp the successor's own version — surviving the
        // completion sweep forever and overwriting tiles the successor had
        // already merged.
        const actorId = await createActor(database)
        const zombie = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq: zombie,
          version: 1,
          tiles: [tile('16:1:1', 3)]
        })

        const successor = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000
        })
        expect(successor.pyramid.claimSeq).not.toBe(zombie)

        const written = await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq: zombie,
          version: 1,
          tiles: [tile('16:1:1', 99), tile('16:2:2', 99)]
        })

        expect(written).toBe(false)
        const tiles = await database.getFitnessRouteHeatmapTilesByKeys({
          actorId,
          tileKeys: ['16:1:1', '16:2:2']
        })
        // Nothing overwritten, and nothing new created.
        expect(tiles).toHaveLength(1)
        expect(tiles[0]).toMatchObject({ tileKey: '16:1:1', pointCount: 3 })
      })

      it('heartbeats the build as it flushes, so a working pass is not reclaimed', async () => {
        const actorId = await createActor(database)
        const claimSeq = await claimBuild(database, actorId)

        const before = await database.getFitnessRouteHeatmapPyramid({ actorId })
        // Real elapsed time, so the heartbeat has somewhere to move to.
        // Asserting `after >= before` would hold with no heartbeat at all,
        // since `updatedAt` can only go forward.
        await new Promise((resolve) => setTimeout(resolve, 5))

        expect(
          await database.upsertFitnessRouteHeatmapTiles({
            actorId,
            claimSeq,
            version: 1,
            tiles: [tile('16:8:8')]
          })
        ).toBe(true)

        const after = await database.getFitnessRouteHeatmapPyramid({ actorId })
        expect(after!.updatedAt).toBeGreaterThan(before!.updatedAt)

        // A staleness cutoff the row only clears BECAUSE the flush wrote a new
        // heartbeat. Reading the cutoff back off the row instead would be
        // `x >= x` — true whatever the flush did.
        const thief = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: before!.updatedAt + 1
        })
        expect(thief.claimed).toBe(false)
        expect(thief.reason).toBe('build-in-progress')
      })

      it('replaces a tile in place on re-flush', async () => {
        const actorId = await createActor(database)
        const claimSeq = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 1,
          tiles: [tile('12:5:5', 2)]
        })
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 2,
          tiles: [
            {
              ...tile('12:5:5', 9),
              segments: '{"e":256,"s":[{"c":3,"p":[1,1,2,2]}]}'
            }
          ]
        })

        const tiles = await database.getFitnessRouteHeatmapTilesByKeys({
          actorId,
          tileKeys: ['12:5:5']
        })
        expect(tiles).toHaveLength(1)
        expect(tiles[0]).toMatchObject({ version: 2, pointCount: 9 })
        expect(tiles[0].segments).toBe('{"e":256,"s":[{"c":3,"p":[1,1,2,2]}]}')
      })

      it('writes a flush larger than SQLite allows bound variables in one statement', async () => {
        const actorId = await createActor(database)
        const claimSeq = await claimBuild(database, actorId)
        // Ten columns per row against SQLite's 999-variable ceiling means the
        // insert has to chunk at ~99 rows; 250 forces three statements.
        const tiles = Array.from({ length: 250 }, (_unused, index) =>
          tile(`14:${index}:0`, 2)
        )

        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 1,
          tiles
        })

        const total = await database.sumFitnessRouteHeatmapTilePoints({
          actorId,
          z: 14,
          minX: 0,
          maxX: 249,
          minY: 0,
          maxY: 0
        })
        expect(total).toBe(500)
      })

      it('splits an oversized key list into several statements', async () => {
        // Asserted on the statements issued rather than the rows returned:
        // better-sqlite3 accepts far more bindings than the project's
        // conservative 999 floor, so an unchunked query of this size still
        // succeeds here and would only fail on another backend. Uses its own
        // database for the raw knex query event.
        const { database: isolated, instance } =
          getTestSQLDatabaseWithInstance()
        await isolated.migrate()
        try {
          const statements: string[] = []
          instance.on('query', ({ sql }: { sql: string }) => {
            if (sql.includes('fitness_route_heatmap_tiles'))
              statements.push(sql)
          })

          await isolated.getFitnessRouteHeatmapTilesByKeys({
            actorId: 'https://llun.test/users/absent',
            tileKeys: Array.from(
              { length: 2_500 },
              (_unused, index) => `16:${index}:0`
            )
          })

          // ceil(2500 / 998), the chunk size being 999 less one binding for
          // actorId.
          expect(statements).toHaveLength(3)
        } finally {
          await isolated.destroy()
        }
      })

      it('assembles results from every chunk of an oversized key list', async () => {
        // The companion to the statement-count test above: real keys sit in
        // the first, second and last chunk, so all three come back only if
        // every chunk's rows are collected.
        const chunkSize = 998
        const actorId = await createActor(database)
        const claimSeq = await claimBuild(database, actorId)
        const keys = ['10:1:1', '10:2:2', '10:3:3']
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 1,
          tiles: keys.map((key) => tile(key, 3))
        })

        const padding = (count: number, band: number) =>
          Array.from(
            { length: count },
            (_unused, index) => `10:${index}:${band}`
          )
        const request = [
          keys[0],
          ...padding(chunkSize - 1, 91),
          keys[1],
          ...padding(chunkSize - 1, 92),
          keys[2]
        ]
        expect(request).toHaveLength(chunkSize * 2 + 1)

        const tiles = await database.getFitnessRouteHeatmapTilesByKeys({
          actorId,
          tileKeys: request
        })
        expect(tiles.map((row) => row.tileKey).sort()).toEqual([...keys].sort())
      })

      it('does nothing for an empty flush or an empty key list', async () => {
        const actorId = await createActor(database)
        const claimSeq = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 1,
          tiles: []
        })
        expect(
          await database.getFitnessRouteHeatmapTilesByKeys({
            actorId,
            tileKeys: []
          })
        ).toEqual([])
      })

      it('never returns another actor tiles', async () => {
        const owner = await createActor(database)
        const other = await createActor(database)
        const ownerClaimSeq = await claimBuild(database, owner)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: owner,
          claimSeq: ownerClaimSeq,
          version: 1,
          tiles: [tile('16:7:7')]
        })

        expect(
          await database.getFitnessRouteHeatmapTilesByKeys({
            actorId: other,
            tileKeys: ['16:7:7']
          })
        ).toEqual([])
        expect(
          await database.getFitnessRouteHeatmapTilesInRange({
            actorId: other,
            z: 16,
            minX: 0,
            maxX: 100,
            minY: 0,
            maxY: 100
          })
        ).toEqual([])
      })
    })

    describe('getFitnessRouteHeatmapTilesInRange', () => {
      it('returns only the tiles inside the viewport at that zoom', async () => {
        const actorId = await createActor(database)
        const claimSeq = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 1,
          tiles: [
            tile('12:10:10'),
            tile('12:11:11'),
            // Outside the x/y window.
            tile('12:50:50'),
            // Right x/y, wrong zoom: a viewport reads one stored zoom.
            tile('14:10:10')
          ]
        })

        const tiles = await database.getFitnessRouteHeatmapTilesInRange({
          actorId,
          z: 12,
          minX: 10,
          maxX: 11,
          minY: 10,
          maxY: 11
        })

        expect(tiles.map((row) => row.tileKey).sort()).toEqual([
          '12:10:10',
          '12:11:11'
        ])
      })

      it('sums the points over a range and reports zero for an empty one', async () => {
        const actorId = await createActor(database)
        const claimSeq = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 1,
          tiles: [tile('8:1:1', 10), tile('8:2:2', 15)]
        })

        expect(
          await database.sumFitnessRouteHeatmapTilePoints({
            actorId,
            z: 8,
            minX: 0,
            maxX: 9,
            minY: 0,
            maxY: 9
          })
        ).toBe(25)
        expect(
          await database.sumFitnessRouteHeatmapTilePoints({
            actorId,
            z: 8,
            minX: 100,
            maxX: 200,
            minY: 100,
            maxY: 200
          })
        ).toBe(0)
      })
    })

    describe('deleteStaleFitnessRouteHeatmapTiles', () => {
      it('drops only the tiles an earlier build left behind', async () => {
        const actorId = await createActor(database)
        const claimSeq = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 1,
          tiles: [tile('16:1:1'), tile('16:2:2')]
        })
        // The next build rewrites one of them and adds a new one; the tile only
        // the old build knew about is the activity that has since been deleted.
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 2,
          tiles: [tile('16:1:1'), tile('16:3:3')]
        })

        const deleted = await database.deleteStaleFitnessRouteHeatmapTiles({
          actorId,
          beforeVersion: 2
        })

        expect(deleted).toBe(1)
        const remaining = await database.getFitnessRouteHeatmapTilesInRange({
          actorId,
          z: 16,
          minX: 0,
          maxX: 10,
          minY: 0,
          maxY: 10
        })
        expect(remaining.map((row) => row.tileKey).sort()).toEqual([
          '16:1:1',
          '16:3:3'
        ])
      })

      it('leaves another actor stale tiles alone', async () => {
        const owner = await createActor(database)
        const other = await createActor(database)
        const ownerClaimSeq = await claimBuild(database, owner)
        const otherClaimSeq = await claimBuild(database, other)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: owner,
          claimSeq: ownerClaimSeq,
          version: 1,
          tiles: [tile('16:4:4')]
        })
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: other,
          claimSeq: otherClaimSeq,
          version: 1,
          tiles: [tile('16:4:4')]
        })

        await database.deleteStaleFitnessRouteHeatmapTiles({
          actorId: owner,
          beforeVersion: 5
        })

        expect(
          await database.getFitnessRouteHeatmapTilesByKeys({
            actorId: other,
            tileKeys: ['16:4:4']
          })
        ).toHaveLength(1)
      })
    })

    describe('deleteFitnessRouteHeatmapPyramidAndTilesForActor', () => {
      it('removes the pyramid and its tiles as one unit', async () => {
        // Atomic on purpose: either order as two separate statements leaves a
        // window a concurrent build can write into — orphan tiles no later
        // sweep can reach, or a build whose freshly-flushed tiles the second
        // statement deletes out from under it.
        const actorId = await createActor(database)
        const claimSeq = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          claimSeq,
          version: 1,
          tiles: [tile('16:1:1'), tile('16:2:2')]
        })

        expect(
          await database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
            actorId
          })
        ).toBe(2)

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        ).toBeNull()
        expect(
          await database.getFitnessRouteHeatmapTilesByKeys({
            actorId,
            tileKeys: ['16:1:1', '16:2:2']
          })
        ).toEqual([])

        // And the token is gone with the row, so a build still in flight is
        // rejected rather than repopulating what was just cleared.
        expect(
          await database.upsertFitnessRouteHeatmapTiles({
            actorId,
            claimSeq,
            version: 1,
            tiles: [tile('16:3:3')]
          })
        ).toBe(false)
      })

      it('leaves another actor pyramid and tiles alone', async () => {
        const owner = await createActor(database)
        const other = await createActor(database)
        const ownerClaimSeq = await claimBuild(database, owner)
        const otherClaimSeq = await claimBuild(database, other)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: owner,
          claimSeq: ownerClaimSeq,
          version: 1,
          tiles: [tile('16:8:8')]
        })
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: other,
          claimSeq: otherClaimSeq,
          version: 1,
          tiles: [tile('16:8:8')]
        })

        expect(
          await database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
            actorId: owner
          })
        ).toBe(1)

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId: other })
        ).not.toBeNull()
        expect(
          await database.getFitnessRouteHeatmapTilesByKeys({
            actorId: other,
            tileKeys: ['16:8:8']
          })
        ).toHaveLength(1)
      })

      it('creates the pyramid row it is about to delete, so there is always a lock to take', async () => {
        // The mechanism, asserted on the statements issued, because what it
        // buys is a lock and a single-threaded test cannot contend for one. A
        // DELETE matching no row takes no lock, so without the insert an actor
        // who has never built has nothing to serialise a concurrent claim
        // against: that claim flushes tiles into the window and the delete
        // below removes them, leaving a build that completes over tiles which
        // no longer exist.
        const { database: isolated, instance } =
          getTestSQLDatabaseWithInstance()
        await isolated.migrate()

        try {
          const actorId = await createActor(isolated)
          const statements: string[] = []
          instance.on('query', ({ sql }: { sql: string }) => {
            if (sql.includes('fitness_route_heatmap_')) statements.push(sql)
          })

          await isolated.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
            actorId
          })

          const verbs = statements.map(
            (sql) => sql.trimStart().toLowerCase().split(' ')[0]
          )
          expect(verbs).toEqual(['insert', 'delete', 'delete'])
          expect(statements[0]).toContain('fitness_route_heatmap_pyramids')
          expect(statements[1]).toContain('fitness_route_heatmap_pyramids')
          expect(statements[2]).toContain('fitness_route_heatmap_tiles')
        } finally {
          await isolated.destroy()
        }
      })

      it('clears an actor that never built anything, without stranding a row', async () => {
        // The empty case is not a no-op: the delete has to leave nothing
        // behind, including the row it creates to have something to lock
        // against a claim arriving mid-transaction.
        const actorId = await createActor(database)

        expect(
          await database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
            actorId
          })
        ).toBe(0)
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        ).toBeNull()
      })
    })
  })
})
