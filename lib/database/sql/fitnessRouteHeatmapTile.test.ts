import type { Knex } from 'knex'

import {
  databaseBeforeAll,
  getTestDatabaseTable,
  getTestDatabaseWithInstance
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
      return claim.pyramid
    }

    // Every guarded write names the build ROW as well as the token, because
    // `claimSeq` restarts at zero when a clear deletes the row.
    const fence = (pyramid: { id: string; claimSeq: number }) => ({
      pyramidId: pyramid.id,
      claimSeq: pyramid.claimSeq
    })

    /**
     * Asserts that two statements ran inside ONE open transaction on ONE
     * connection.
     *
     * Structural, because what these transactions prevent is a failure between
     * two round trips and there is no seam to inject one at. Order alone is not
     * enough: keeping the `database.transaction(...)` wrapper while building a
     * query on `database` instead of `trx` — the likeliest refactoring slip
     * there is — leaves the order untouched while that statement autocommits on
     * a pooled connection, which is the state these transactions exist to
     * remove. The pool also hands the same connection to unrelated
     * transactions, so "a BEGIN appeared earlier" is not enough either; the one
     * that matters must still be open.
     */
    const expectOneTransaction = (
      statements: Array<{ sql: string; connection: string }>,
      firstMatches: (sql: string) => boolean,
      secondMatches: (sql: string) => boolean
    ) => {
      // Without this the whole helper degrades to an order-only check the
      // moment knex stops carrying `__knexUid`, which is exactly the weaker
      // assertion it was written to replace.
      for (const statement of statements) {
        expect(typeof statement.connection).toBe('string')
      }

      const firstIndex = statements.findIndex(({ sql }) => firstMatches(sql))
      expect(firstIndex).toBeGreaterThan(-1)
      const secondIndex = statements.findIndex(
        ({ sql }, index) => index > firstIndex && secondMatches(sql)
      )
      expect(secondIndex).toBeGreaterThan(firstIndex)

      const connection = statements[firstIndex].connection
      expect(statements[secondIndex].connection).toBe(connection)

      const onConnection = (index: number) =>
        statements[index].connection === connection
      const opens = (index: number) =>
        onConnection(index) && /^begin/i.test(statements[index].sql)
      const closes = (index: number) =>
        onConnection(index) && /^(commit|rollback)/i.test(statements[index].sql)

      let open = false
      for (let index = 0; index < firstIndex; index += 1) {
        if (opens(index)) open = true
        else if (closes(index)) open = false
      }
      expect(open).toBe(true)

      for (let index = firstIndex; index < secondIndex; index += 1) {
        expect(closes(index)).toBe(false)
      }
    }

    const recordStatements = (instance: Knex) => {
      const statements: Array<{ sql: string; connection: string }> = []
      instance.on(
        'query',
        ({ sql, __knexUid }: { sql: string; __knexUid: string }) => {
          statements.push({ sql: sql.trimStart(), connection: __knexUid })
        }
      )
      return statements
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
        // between. Staged by clearing on the read itself, which is that window.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
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

      it('carries the claim decision into the compare-and-swap itself', async () => {
        // Asserted on the statement issued rather than on an outcome, because
        // the interleaving this guards against — the owner heartbeating or
        // completing between this claim's read and its write — cannot be
        // staged deterministically from a single-threaded test. What can be
        // pinned is that the UPDATE re-tests the state the decision was made
        // on instead of trusting the token alone; without that clause the
        // read's verdict is a snapshot the write never rechecks.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
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

          // Identifier quoting is dialect-specific — backticks on SQLite,
          // double quotes on PostgreSQL — so normalise before matching, or the
          // assertions below silently mean nothing on one of the two backends
          // this SQL has to be correct on.
          const whereOfLastUpdate = () => {
            expect(updates).toHaveLength(1)
            const [cas] = updates
            const where = cas
              .slice(cas.toLowerCase().indexOf(' where '))
              .replace(/[`"]/g, '"')
            updates.length = 0
            return where
          }

          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          expect(claim.claimed).toBe(true)

          // Only the WHERE half. The SET half writes `status`, `updatedAt` and
          // `completedAt` on every fresh claim, so asserting against the whole
          // statement would pass with no guard at all.
          const whereClause = whereOfLastUpdate()

          // The row and the token together — the token alone repeats across a
          // clear, which deletes the row and restarts the sequence.
          expect(whereClause).toContain('"claimSeq"')
          expect(whereClause).toContain('"id"')
          // The two halves of "not already fresh, and not still running".
          expect(whereClause).toContain('"completedAt"')
          expect(whereClause).toContain('"updatedAt"')
          expect(whereClause).toContain('"status"')
          // A fresh claim decided nothing from the cursor — it is about to
          // clear it — so there is no premise about it here. Asserting one
          // would make the statement miss the abandoned `generating` row that
          // still holds a cursor, which is exactly the row a fresh build has to
          // take over, and the claim would then fail forever with nobody able
          // to own the row and clear it.
          expect(whereClause).not.toContain('"cursorId"')

          // A claim that decided to RESUME is the mirror image: it keeps the
          // version and adds to the build's tiles, so it needs the row to still
          // BE that build — still generating, still holding the cursor it will
          // carry on from.
          await isolated.updateFitnessRouteHeatmapPyramid({
            actorId,
            ...fence(claim.pyramid),
            cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' }
          })
          updates.length = 0

          const resumedClaim =
            await isolated.claimFitnessRouteHeatmapPyramidBuild({
              actorId,
              requestedAt: Date.now(),
              staleBefore: Date.now() + 60_000,
              resumeBuild: fence(claim.pyramid)
            })
          expect(resumedClaim.resumed).toBe(true)

          const resumedWhere = whereOfLastUpdate()
          // BOTH cursor columns, exactly as `parseSQLFitnessRouteHeatmapPyramid`
          // reads them: a premise that tested one would call a half-written
          // cursor resumable on one side and not the other, and that row's
          // claim can then never match its own decision.
          expect(resumedWhere).toContain('"cursorCreatedAt"')
          expect(resumedWhere).toContain('"cursorId"')
          expect(resumedWhere).toContain('"status"')

          // A claimer presenting no token cannot resume, however abandoned the
          // build looks — it can offer no evidence about which activities it
          // will re-present, so it takes a fresh version instead and its
          // statement carries no cursor premise.
          const current = await isolated.getFitnessRouteHeatmapPyramid({
            actorId
          })
          updates.length = 0
          const freshOnly = await isolated.claimFitnessRouteHeatmapPyramidBuild(
            {
              actorId,
              requestedAt: Date.now(),
              staleBefore: Date.now() + 60_000
            }
          )
          expect(freshOnly.claimed).toBe(true)
          expect(freshOnly.resumed).toBe(false)

          const freshOnlyWhere = whereOfLastUpdate()
          expect(freshOnlyWhere).toContain('"claimSeq"')
          expect(freshOnlyWhere).not.toContain('"cursorId"')
          expect(freshOnlyWhere).not.toContain('"cursorCreatedAt"')
          // The row it read is still the row it writes, even here.
          expect(freshOnlyWhere).toContain('"id"')
          expect(current).toBeDefined()
        } finally {
          await isolated.destroy()
        }
      })

      describe('when the row changes between the claim read and its write', () => {
        // Everything here stages the ONE window the ownership token cannot
        // cover on its own: the claim reads, decides, and only then writes, so
        // an incumbent that moves the row in between must be caught by the
        // write re-asserting the read's premises. Staged from the claim's own
        // SELECT, which IS that window, rather than raced.
        const stageOnClaimRead = (
          instance: Knex,
          interfere: () => Promise<unknown>
        ) => {
          const state = { fired: false }
          const onRead = async ({ sql }: { sql: string }) => {
            if (
              state.fired ||
              !sql.trimStart().toLowerCase().startsWith('select') ||
              !sql.includes('fitness_route_heatmap_pyramids')
            ) {
              return
            }
            state.fired = true
            await interfere()
          }
          instance.on(
            'query-response',
            (_response: unknown, query: unknown) =>
              void onRead(query as { sql: string })
          )
          return state
        }

        it('refuses a claim whose build heartbeats exactly onto the boundary', async () => {
          // The SQL half of `updatedAt >= staleBefore`. The JS classifier
          // short-circuits on a row that already looks live, so the only way to
          // reach `applyClaimableFilter`'s own comparison is to make the row
          // look stale at read time and live at write time — and the boundary
          // is where a `<` relaxed to `<=` stops refusing. Both clocks here are
          // `Date.now()`, so landing exactly on it is ordinary.
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

            const staleBefore = Date.now()
            await instance('fitness_route_heatmap_pyramids')
              .where('actorId', actorId)
              .update({ updatedAt: new Date(staleBefore - 60_000) })

            // The owner heartbeats onto the boundary itself.
            const staged = stageOnClaimRead(instance, () =>
              instance('fitness_route_heatmap_pyramids')
                .where('actorId', actorId)
                .update({ updatedAt: new Date(staleBefore) })
            )

            const thief = await isolated.claimFitnessRouteHeatmapPyramidBuild({
              actorId,
              requestedAt: Date.now(),
              staleBefore
            })

            expect(staged.fired).toBe(true)
            expect({ claimed: thief.claimed, reason: thief.reason }).toEqual({
              claimed: false,
              reason: 'build-in-progress'
            })
            expect(
              await isolated.getFitnessRouteHeatmapPyramid({ actorId })
            ).toMatchObject({
              claimSeq: owner.pyramid.claimSeq,
              version: owner.pyramid.version,
              status: 'generating'
            })
          } finally {
            await isolated.destroy()
          }
        })

        it('refuses a claim whose build completed inside the window', async () => {
          // The interleaving the CAS's own comment names — "a completion that
          // lands there would let it throw away the very pyramid the request
          // was asking for" — and the one no staged test reached: every other
          // one stages a heartbeat or a resume-premise change. Staged at the
          // BOUNDARY, `completedAt === requestedAt`, because that is where a
          // `<` relaxed to `<=` stops refusing, and two operations landing in
          // the same millisecond is not hypothetical here: an earlier flake in
          // this very suite was two job runs sharing one `Date.now()`.
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

            // Abandoned-looking at read time...
            await instance('fitness_route_heatmap_pyramids')
              .where('actorId', actorId)
              .update({ updatedAt: new Date(Date.now() - 600_000) })

            const requestedAt = Date.now()
            // ...and finished by its owner before the write lands.
            const staged = stageOnClaimRead(instance, () =>
              instance('fitness_route_heatmap_pyramids')
                .where('actorId', actorId)
                .update({
                  status: 'completed',
                  completedAt: new Date(requestedAt),
                  tileCount: 99,
                  updatedAt: new Date()
                })
            )

            const thief = await isolated.claimFitnessRouteHeatmapPyramidBuild({
              actorId,
              requestedAt,
              staleBefore: Date.now() - 120_000
            })

            expect(staged.fired).toBe(true)
            // The REASON, not just the refusal: the post-CAS re-classification
            // is what tells the caller it can serve this request from a
            // finished pyramid instead of giving up and rebuilding.
            expect({ claimed: thief.claimed, reason: thief.reason }).toEqual({
              claimed: false,
              reason: 'already-fresh'
            })
            // The finished pyramid is untouched — not reset to `generating`
            // with its counters cleared over tiles it still describes.
            expect(
              await isolated.getFitnessRouteHeatmapPyramid({ actorId })
            ).toMatchObject({
              status: 'completed',
              version: owner.pyramid.version,
              completedAt: requestedAt,
              tileCount: 99
            })
          } finally {
            await isolated.destroy()
          }
        })

        it.each([
          {
            description: 'the row it names but not the token it held',
            half: (pyramid: { id: string; claimSeq: number }) => ({
              pyramidId: pyramid.id,
              claimSeq: pyramid.claimSeq + 7
            })
          },
          {
            description: 'the token it held but not the row it names',
            half: (pyramid: { id: string; claimSeq: number }) => ({
              pyramidId: crypto.randomUUID(),
              claimSeq: pyramid.claimSeq
            })
          }
        ])(
          'refuses a continuation presenting $description',
          async ({ half }) => {
            // The own-continuation exemption is the one thing allowed to take a
            // live `generating` row, so BOTH halves of it have to match. The
            // row id alone repeats across a clear — which deletes the row and
            // restarts the sequence — and the sequence alone is what a stale
            // token from an earlier pass still holds; either half on its own
            // hands a demonstrably live build to a stranger.
            const {
              database: isolated,
              instance,
              prepare: prepareIsolated
            } = getTestDatabaseWithInstance(true)
            await prepareIsolated()
            await isolated.migrate()

            try {
              const actorId = await createActor(isolated)
              const owner = await isolated.claimFitnessRouteHeatmapPyramidBuild(
                {
                  actorId,
                  requestedAt: Date.now(),
                  staleBefore: Date.now() - 120_000
                }
              )
              expect(owner.claimed).toBe(true)

              // Abandoned-looking at read time, alive again by the write.
              await instance('fitness_route_heatmap_pyramids')
                .where('actorId', actorId)
                .update({ updatedAt: new Date(Date.now() - 600_000) })
              const staged = stageOnClaimRead(instance, () =>
                instance('fitness_route_heatmap_pyramids')
                  .where('actorId', actorId)
                  .update({ updatedAt: new Date() })
              )

              const stranger =
                await isolated.claimFitnessRouteHeatmapPyramidBuild({
                  actorId,
                  requestedAt: Date.now(),
                  staleBefore: Date.now() - 120_000,
                  resumeBuild: half(owner.pyramid)
                })

              expect(staged.fired).toBe(true)
              expect(stranger.claimed).toBe(false)
              // The owner's build is untouched, token and all.
              expect(
                await isolated.getFitnessRouteHeatmapPyramid({ actorId })
              ).toMatchObject({
                claimSeq: owner.pyramid.claimSeq,
                version: owner.pyramid.version,
                status: 'generating'
              })
            } finally {
              await isolated.destroy()
            }
          }
        )

        it('refuses a resume whose build stopped generating before the write', async () => {
          // A resume keeps the version and ADDS to the build's tiles, so it
          // needs the row to still be that build. An incumbent that wakes in
          // this window and writes its terminal state moves neither the token
          // nor the version, so without the premise re-asserted the winner is
          // told it resumed, and folds into tiles no version change will ever
          // sweep.
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
            await isolated.updateFitnessRouteHeatmapPyramid({
              actorId,
              ...fence(owner.pyramid),
              cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' }
            })

            const staged = stageOnClaimRead(instance, () =>
              instance('fitness_route_heatmap_pyramids')
                .where('actorId', actorId)
                .update({ status: 'failed' })
            )

            const continuation =
              await isolated.claimFitnessRouteHeatmapPyramidBuild({
                actorId,
                requestedAt: Date.now(),
                staleBefore: Date.now() - 120_000,
                resumeBuild: fence(owner.pyramid)
              })

            expect(staged.fired).toBe(true)
            expect(continuation.claimed).toBe(false)
          } finally {
            await isolated.destroy()
          }
        })

        it.each([
          { description: 'cleared', cleared: ['cursorCreatedAt', 'cursorId'] },
          {
            description: 'half-cleared to a bare id',
            cleared: ['cursorCreatedAt']
          },
          {
            description: 'half-cleared to a bare timestamp',
            cleared: ['cursorId']
          }
        ])(
          'refuses a resume whose cursor was $description before the write',
          async ({ cleared }) => {
            // The mirror of the case above, and the reason BOTH cursor columns
            // are re-asserted rather than one: a resume that finds no cursor
            // rescans from the beginning into that build's own tiles, doubling
            // every count it revisits under a version the sweep will never move.
            // The half-cleared rows are the same states `never treats a
            // half-written cursor as resumable on one side only` pins at the
            // read — a column left behind is not a cursor, at the write either.
            const {
              database: isolated,
              instance,
              prepare: prepareIsolated
            } = getTestDatabaseWithInstance(true)
            await prepareIsolated()
            await isolated.migrate()

            try {
              const actorId = await createActor(isolated)
              const owner = await isolated.claimFitnessRouteHeatmapPyramidBuild(
                {
                  actorId,
                  requestedAt: Date.now(),
                  staleBefore: Date.now() - 120_000
                }
              )
              await isolated.updateFitnessRouteHeatmapPyramid({
                actorId,
                ...fence(owner.pyramid),
                cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' }
              })

              const staged = stageOnClaimRead(instance, () =>
                instance('fitness_route_heatmap_pyramids')
                  .where('actorId', actorId)
                  .update(
                    Object.fromEntries(cleared.map((column) => [column, null]))
                  )
              )

              const continuation =
                await isolated.claimFitnessRouteHeatmapPyramidBuild({
                  actorId,
                  requestedAt: Date.now(),
                  staleBefore: Date.now() - 120_000,
                  resumeBuild: fence(owner.pyramid)
                })

              expect(staged.fired).toBe(true)
              expect(continuation.claimed).toBe(false)
            } finally {
              await isolated.destroy()
            }
          }
        )
      })

      it.each([
        {
          description: 'has not reached an activity yet',
          prepare: async () => {}
        },
        {
          description: 'its own owner released it',
          prepare: async (
            db: Database,
            actorId: string,
            pyramid: { id: string; claimSeq: number }
          ) => {
            await db.updateFitnessRouteHeatmapPyramid({
              actorId,
              pyramidId: pyramid.id,
              claimSeq: pyramid.claimSeq,
              cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' },
              status: 'failed'
            })
          }
        }
      ])(
        'gives a continuation a fresh version, not a resume, when the build $description',
        async ({ prepare }) => {
          // `resumed` is a conjunction, and each half has to hold at the write
          // as well as the read, because `applyResumePremiseFilter` re-asserts
          // exactly the same two. A verdict either side computes alone matches
          // no row at all: the claim answers `lost-race` on every attempt, and
          // nobody can own the row to clear the state that caused it. So the
          // right answer here is not a refusal — it is a clean fresh build.
          const actorId = await createActor(database)
          const first = await database.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          await prepare(database, actorId, first.pyramid)

          const continuation =
            await database.claimFitnessRouteHeatmapPyramidBuild({
              actorId,
              requestedAt: Date.now(),
              staleBefore: Date.now() - 120_000,
              resumeBuild: fence(first.pyramid)
            })

          expect({
            claimed: continuation.claimed,
            reason: continuation.reason,
            resumed: continuation.resumed
          }).toEqual({ claimed: true, reason: 'claimed', resumed: false })
          // A fresh version, so its tiles replace the build's rather than
          // adding to them — and the sweep can reach the old ones.
          expect(continuation.pyramid.version).toBe(first.pyramid.version + 1)
          expect(continuation.pyramid.cursor).toBeUndefined()
        }
      )

      it('confirms its own compare-and-swap inside the same transaction', async () => {
        // Structural, because the failure it prevents is a throw between two
        // round trips and there is no seam to inject one at. Two things rest on
        // this. A CAS that commits and is then followed by a read that fails —
        // a pool timeout, a reset connection — leaves the row stamped
        // `generating` at a token the caller never learned it held, so every
        // claimant is refused `build-in-progress` while nothing writes; rolling
        // back means a claim either happens and is reported or does not happen.
        // And the read seeing this pass's own write is what makes the reported
        // version and token trustworthy: read outside, a rival claim landing in
        // between would be reported as this pass's own.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
        await isolated.migrate()

        try {
          const actorId = await createActor(isolated)
          // The CONNECTION each statement ran on, not just the order they were
          // emitted in. Keeping the `database.transaction(...)` wrapper while
          // building the queries on `database` instead of `trx` — the likeliest
          // refactoring slip there is — leaves the order untouched while the
          // CAS autocommits on a pooled connection, which is the state this
          // transaction exists to remove.
          const statements: Array<{ sql: string; connection: string }> = []
          instance.on(
            'query',
            ({ sql, __knexUid }: { sql: string; __knexUid: string }) => {
              statements.push({ sql: sql.trimStart(), connection: __knexUid })
            }
          )

          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          expect(claim.claimed).toBe(true)

          const isPyramid = (sql: string) =>
            sql.includes('fitness_route_heatmap_pyramids')
          const casIndex = statements.findIndex(
            ({ sql }) =>
              isPyramid(sql) && sql.toLowerCase().startsWith('update')
          )
          expect(casIndex).toBeGreaterThan(-1)
          const readIndex = statements.findIndex(
            ({ sql }, index) =>
              index > casIndex &&
              isPyramid(sql) &&
              sql.toLowerCase().startsWith('select')
          )
          expect(readIndex).toBeGreaterThan(casIndex)

          const casConnection = statements[casIndex].connection
          expect(statements[readIndex].connection).toBe(casConnection)

          // A transaction open ON THAT CONNECTION at the CAS, and still open at
          // the read. Not merely "a BEGIN appeared earlier": the pool hands the
          // same connection to unrelated transactions, so one that has since
          // committed satisfies a looser check while the CAS itself
          // autocommits.
          const onCasConnection = (index: number) =>
            statements[index].connection === casConnection
          const opens = (index: number) =>
            onCasConnection(index) && /^begin/i.test(statements[index].sql)
          const closes = (index: number) =>
            onCasConnection(index) &&
            /^(commit|rollback)/i.test(statements[index].sql)

          let openAtCas = false
          for (let index = 0; index < casIndex; index += 1) {
            if (opens(index)) openAtCas = true
            else if (closes(index)) openAtCas = false
          }
          expect(openAtCas).toBe(true)

          for (let index = casIndex; index < readIndex; index += 1) {
            expect(closes(index)).toBe(false)
          }
          // NOTE: on SQLite the pool is one connection, so the specific slip of
          // building on `database` while keeping the wrapper deadlocks rather
          // than reaching these assertions. It fails cleanly on PostgreSQL,
          // which is why this is worth running there as well as in CI.
        } finally {
          await isolated.destroy()
        }
      })

      it('never hands back a row its own compare-and-swap did not write', async () => {
        // The claim's confirming read shares the compare-and-swap's
        // transaction, which is what makes the row it reports the row it wrote.
        // Read outside that transaction, two things could land in between and
        // both are silent corruption: a rival claim on the same row, whose live
        // token this pass would then report and every later write would accept
        // — the fence failing open for two passes at once; and a clear, which
        // deletes the row and lets the next generate create another whose first
        // claim also holds token 1, so this pass would walk away with the
        // replacement's identity, version and token, merging its tiles into a
        // live build where no sweep can reach them.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
        await isolated.migrate()

        try {
          const actorId = await createActor(isolated)
          const replacementId = crypto.randomUUID()

          // Fires on the claim's own UPDATE — the CAS-to-read window.
          let interfered = false
          const swapTheRowOut = async ({ sql }: { sql: string }) => {
            if (
              interfered ||
              !sql.trimStart().toLowerCase().startsWith('update') ||
              !sql.includes('fitness_route_heatmap_pyramids')
            ) {
              return
            }
            interfered = true
            await instance('fitness_route_heatmap_pyramids')
              .where('actorId', actorId)
              .delete()
            await instance('fitness_route_heatmap_pyramids').insert({
              id: replacementId,
              actorId,
              status: 'generating',
              error: null,
              version: 7,
              claimSeq: 1,
              totalCount: 0,
              scannedCount: 0,
              activityCount: 0,
              tileCount: 0,
              pointCount: 0,
              cursorCreatedAt: null,
              cursorId: null,
              completedAt: null,
              createdAt: new Date(),
              updatedAt: new Date()
            })
          }
          instance.on('query-response', (_response, query) => {
            void swapTheRowOut(query)
          })

          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })

          // Without this the test passes with the interference removed
          // entirely — a proxy assertion where the invariant was wanted, which
          // is the shape that has to be checked rather than assumed.
          expect(interfered).toBe(true)

          // Whatever the interference did, it is not this claim's build: the
          // replacement's identity, version and token never leak into the
          // answer.
          expect(claim.pyramid.id).not.toBe(replacementId)
          expect(claim.pyramid.version).not.toBe(7)
          if (claim.claimed) {
            expect(claim.pyramid.claimSeq).toBe(1)
            // And a write fenced on what it was handed cannot reach the
            // replacement build.
            await isolated.updateFitnessRouteHeatmapPyramid({
              actorId,
              pyramidId: claim.pyramid.id,
              claimSeq: claim.pyramid.claimSeq,
              scannedCount: 99
            })
          }

          const survivor = await isolated.getFitnessRouteHeatmapPyramid({
            actorId
          })
          if (survivor?.id === replacementId) {
            expect(survivor).toMatchObject({
              claimSeq: 1,
              version: 7,
              scannedCount: 0
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

      it('refuses a tile flush from a pass stranded across a clear', async () => {
        // The claim names the row to survive a clear; the WRITE has to as well.
        // `claimSeq` restarts at zero with the new row, so a pass still holding
        // the old build's token would otherwise flush its tiles and its cursor
        // straight into the replacement build — landing on the likeliest value
        // of all, since both builds' first claim is token 1.
        const actorId = await createActor(database)
        const stranded = await claimBuild(database, actorId)

        await database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
          actorId
        })
        const live = await claimBuild(database, actorId)
        expect(live.claimSeq).toBe(stranded.claimSeq)
        expect(live.id).not.toBe(stranded.id)

        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(live),
          cursor: { createdAt: 2_000_000, id: 'live-file' },
          scannedCount: 3
        })

        const strandedWrite = await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(stranded),
          version: 1,
          tiles: [tile('16:1:1')],
          progress: {
            scannedCount: 999,
            cursor: { createdAt: 1_000_000, id: 'stranded-file' }
          }
        })

        expect(strandedWrite).toBe(false)

        // The progress/terminal-status write is fenced the same way, or the
        // stranded pass simply marks the replacement build failed instead.
        expect(
          await database.updateFitnessRouteHeatmapPyramid({
            actorId,
            ...fence(stranded),
            status: 'failed',
            error: 'stranded pass giving up',
            scannedCount: 999,
            cursor: { createdAt: 1_000_000, id: 'stranded-file' }
          })
        ).toBe(false)

        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId
        })
        expect(pyramid?.status).toBe('generating')
        expect(pyramid?.scannedCount).toBe(3)
        expect(pyramid?.cursor).toEqual({
          createdAt: 2_000_000,
          id: 'live-file'
        })
        expect(
          await database.getFitnessRouteHeatmapTilesByKeys({
            actorId,
            tileKeys: ['16:1:1']
          })
        ).toEqual([])
      })

      it('writes progress inside the same fence as the tiles', async () => {
        // The progress payload rides the guarded statement, so a superseded
        // pass must not be able to rewind its successor's cursor with it.
        const actorId = await createActor(database)
        const owner = await claimBuild(database, actorId)
        expect(
          await database.upsertFitnessRouteHeatmapTiles({
            actorId,
            ...fence(owner),
            version: 1,
            tiles: [tile('16:5:5')],
            progress: {
              scannedCount: 7,
              activityCount: 6,
              cursor: { createdAt: 1_500_000, id: 'owned-file' }
            }
          })
        ).toBe(true)
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        ).toMatchObject({ scannedCount: 7, activityCount: 6 })

        const successor = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000,
          resumeBuild: fence(owner)
        })
        expect(successor.claimed).toBe(true)

        const zombieWrite = await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(owner),
          version: 1,
          tiles: [],
          progress: {
            scannedCount: 1,
            cursor: { createdAt: 1_000, id: 'stale-file' }
          }
        })

        expect(zombieWrite).toBe(false)
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        ).toMatchObject({
          scannedCount: 7,
          cursor: { createdAt: 1_500_000, id: 'owned-file' }
        })
      })

      it('writes every progress field the caller supplies, and only those', async () => {
        // `scannedCount` is unconditional; the rest are spread only when
        // supplied, and a `progress` with no cursor must LEAVE the stored one
        // alone rather than clearing it — a flush that folded nothing still
        // records how far the scan reached, and wiping the cursor there would
        // make the build unresumable.
        const actorId = await createActor(database)
        const build = await claimBuild(database, actorId)

        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
          version: build.version,
          tiles: [tile('16:5:5')],
          progress: {
            scannedCount: 3,
            activityCount: 2,
            totalCount: 9,
            cursor: { createdAt: 1_700_000_000_000, id: 'activity-7' }
          }
        })

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        ).toMatchObject({
          scannedCount: 3,
          activityCount: 2,
          totalCount: 9,
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-7' }
        })

        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
          version: build.version,
          tiles: [],
          progress: { scannedCount: 4 }
        })

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        ).toMatchObject({
          scannedCount: 4,
          // Untouched, because they were not supplied.
          activityCount: 2,
          totalCount: 9,
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-7' }
        })
      })

      it('totals only the tiles belonging to the version asked for', async () => {
        // A completing build stamps these on its own row, and the tiles it is
        // about to sweep are still on disk at that moment — counting them would
        // make every pyramid report the previous build's size on top of its own.
        const actorId = await createActor(database)
        const build = await claimBuild(database, actorId)

        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
          version: 1,
          tiles: [tile('16:1:1', 4), tile('16:2:2', 6)]
        })
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
          version: 2,
          tiles: [tile('14:3:3', 10)]
        })

        expect(
          await database.getFitnessRouteHeatmapTileTotals({
            actorId,
            version: 1
          })
        ).toEqual({ tileCount: 2, pointCount: 10 })
        expect(
          await database.getFitnessRouteHeatmapTileTotals({
            actorId,
            version: 2
          })
        ).toEqual({ tileCount: 1, pointCount: 10 })
        expect(
          await database.getFitnessRouteHeatmapTileTotals({
            actorId,
            version: 9
          })
        ).toEqual({ tileCount: 0, pointCount: 0 })
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
          ...fence(claim.pyramid),
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
          ...fence(first.pyramid),
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
          ...fence(dying.pyramid),
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-50' },
          scannedCount: 50
        })

        const reclaimer = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000,
          resumeBuild: fence(dying.pyramid)
        })
        expect(reclaimer.resumed).toBe(true)
        // Same tile generation, so the interrupted pass's tiles survive...
        expect(reclaimer.pyramid.version).toBe(dying.pyramid.version)
        // ...but a new owner.
        expect(reclaimer.pyramid.claimSeq).toBe(dying.pyramid.claimSeq + 1)

        const zombieWrite = await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(dying.pyramid),
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
          ...fence(claim.pyramid),
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-7' }
        })

        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          ...fence(claim.pyramid),
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
        const build = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
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
          ...fence(zombie),
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
          ...fence(zombie),
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
        const build = await claimBuild(database, actorId)

        const before = await database.getFitnessRouteHeatmapPyramid({ actorId })
        // Real elapsed time, so the heartbeat has somewhere to move to.
        // Asserting `after >= before` would hold with no heartbeat at all,
        // since `updatedAt` can only go forward.
        await new Promise((resolve) => setTimeout(resolve, 5))

        expect(
          await database.upsertFitnessRouteHeatmapTiles({
            actorId,
            ...fence(build),
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
        const build = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
          version: 1,
          tiles: [tile('12:5:5', 2)]
        })
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
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
        const build = await claimBuild(database, actorId)
        // Ten columns per row against SQLite's 999-variable ceiling means the
        // insert has to chunk at ~99 rows; 250 forces three statements.
        const tiles = Array.from({ length: 250 }, (_unused, index) =>
          tile(`14:${index}:0`, 2)
        )

        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
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
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
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
        const build = await claimBuild(database, actorId)
        const keys = ['10:1:1', '10:2:2', '10:3:3']
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
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
        const build = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
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

      it('rolls the progress back with the tiles when a tile write fails', async () => {
        // Atomicity is the whole point of writing both in one statement: the
        // cursor stored must cover exactly the tiles stored with it. Split
        // apart, a tile insert that fails after the cursor advanced leaves the
        // build claiming to have folded activities whose tiles were rolled
        // back — and the resume then skips them and completes over the hole.
        const actorId = await createActor(database)
        const build = await claimBuild(database, actorId)

        await expect(
          database.upsertFitnessRouteHeatmapTiles({
            actorId,
            ...fence(build),
            version: build.version,
            // `z` is `integer not null`, so this write cannot land.
            tiles: [{ ...tile('16:9:9'), z: null as unknown as number }],
            progress: {
              scannedCount: 12,
              activityCount: 9,
              cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' }
            }
          })
        ).rejects.toThrow()

        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        ).toMatchObject({
          scannedCount: 0,
          activityCount: 0,
          cursor: undefined
        })
      })

      it('answers a flush with nothing to write from the guard, not from a shortcut', async () => {
        // The return means "you still own this build". Answering `true`
        // without looking, just because there was nothing to write, would tell
        // a superseded pass to carry on folding into somebody else's build.
        const actorId = await createActor(database)
        const build = await claimBuild(database, actorId)

        expect(
          await database.upsertFitnessRouteHeatmapTiles({
            actorId,
            pyramidId: build.id,
            claimSeq: build.claimSeq + 1,
            version: build.version,
            tiles: []
          })
        ).toBe(false)
      })

      it('writes the tiles and the progress inside one transaction', async () => {
        // The fence, the progress and the tile rows must commit or roll back
        // together: a cursor that advanced past tiles which were rolled back is
        // a build that skips them on resume and completes over the hole. Pinned
        // by connection rather than by order — see `expectOneTransaction`.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
        await isolated.migrate()

        try {
          const actorId = await createActor(isolated)
          const build = await claimBuild(isolated, actorId)
          const statements = recordStatements(instance)

          await isolated.upsertFitnessRouteHeatmapTiles({
            actorId,
            ...fence(build),
            version: build.version,
            tiles: [tile('16:3:3')],
            progress: {
              scannedCount: 1,
              cursor: { createdAt: 1_700_000_000_000, id: 'activity-1' }
            }
          })

          expectOneTransaction(
            statements,
            (sql) =>
              /^update/i.test(sql) &&
              sql.includes('fitness_route_heatmap_pyramids'),
            (sql) =>
              /^insert/i.test(sql) &&
              sql.includes('fitness_route_heatmap_tiles')
          )
        } finally {
          await isolated.destroy()
        }
      })

      it('never returns another actor tiles', async () => {
        const owner = await createActor(database)
        const other = await createActor(database)
        const ownerBuild = await claimBuild(database, owner)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: owner,
          ...fence(ownerBuild),
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
        const build = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
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
        const build = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
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
        const build = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
          version: 1,
          tiles: [tile('16:1:1'), tile('16:2:2')]
        })
        // The next build rewrites one of them and adds a new one; the tile only
        // the old build knew about is the activity that has since been deleted.
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
          version: 2,
          tiles: [tile('16:1:1'), tile('16:3:3')]
        })

        const deleted = await database.deleteStaleFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
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

      it('refuses a sweep from a pass stranded across a clear', async () => {
        // The sweep is a write like any other, and it is the one that DELETES,
        // so it is fenced like any other. `claimSeq` counts from zero per row
        // and a clear deletes the row, so the replacement build starts at the
        // same token — leaving only the row id to tell them apart. Unfenced,
        // this call wipes the replacement's tiles and that build then stamps
        // itself `completed` over tiles that are gone.
        const actorId = await createActor(database)
        const stranded = await claimBuild(database, actorId)

        await database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
          actorId
        })

        const replacement = await claimBuild(database, actorId)
        expect(replacement.id).not.toBe(stranded.id)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(replacement),
          version: replacement.version,
          tiles: [tile('16:7:7'), tile('16:8:8')]
        })

        const deleted = await database.deleteStaleFitnessRouteHeatmapTiles({
          actorId,
          ...fence(stranded),
          beforeVersion: stranded.version + 1
        })

        expect(deleted).toBe(0)
        expect(
          await database.getFitnessRouteHeatmapTilesByKeys({
            actorId,
            tileKeys: ['16:7:7', '16:8:8']
          })
        ).toHaveLength(2)
      })

      it('takes the row lock and deletes inside one transaction', async () => {
        // The guarded UPDATE is both the ownership check and the row lock that
        // serialises this delete against a concurrent claim or clear. On the
        // pool it is neither — the lock is released before the DELETE runs, and
        // the window it exists to close reopens.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
        await isolated.migrate()

        try {
          const actorId = await createActor(isolated)
          const build = await claimBuild(isolated, actorId)
          await isolated.upsertFitnessRouteHeatmapTiles({
            actorId,
            ...fence(build),
            version: build.version,
            tiles: [tile('16:1:1')]
          })
          const statements = recordStatements(instance)

          await isolated.deleteStaleFitnessRouteHeatmapTiles({
            actorId,
            ...fence(build),
            beforeVersion: build.version + 1
          })

          expectOneTransaction(
            statements,
            (sql) =>
              /^update/i.test(sql) &&
              sql.includes('fitness_route_heatmap_pyramids'),
            (sql) =>
              /^delete/i.test(sql) &&
              sql.includes('fitness_route_heatmap_tiles')
          )
        } finally {
          await isolated.destroy()
        }
      })

      it('refuses a sweep from a pass whose build was taken over', async () => {
        // The row half of the fence is not enough on its own: a pass presumed
        // dead and superseded IN PLACE holds the right row id and a stale
        // token, and its sweep would delete the tiles its successor wrote at
        // the older version it is still resuming from.
        const actorId = await createActor(database)
        const superseded = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(superseded),
          version: superseded.version,
          tiles: [tile('16:11:11')]
        })

        // Taken over in place — same row, new token.
        const successor = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() + 60_000
        })
        expect(successor.claimed).toBe(true)
        expect(successor.pyramid.id).toBe(superseded.id)

        const deleted = await database.deleteStaleFitnessRouteHeatmapTiles({
          actorId,
          ...fence(superseded),
          beforeVersion: successor.pyramid.version
        })

        expect(deleted).toBe(0)
        expect(
          await database.getFitnessRouteHeatmapTilesByKeys({
            actorId,
            tileKeys: ['16:11:11']
          })
        ).toHaveLength(1)
      })

      it('leaves another actor stale tiles alone', async () => {
        const owner = await createActor(database)
        const other = await createActor(database)
        const ownerBuild = await claimBuild(database, owner)
        const otherBuild = await claimBuild(database, other)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: owner,
          ...fence(ownerBuild),
          version: 1,
          tiles: [tile('16:4:4')]
        })
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: other,
          ...fence(otherBuild),
          version: 1,
          tiles: [tile('16:4:4')]
        })

        await database.deleteStaleFitnessRouteHeatmapTiles({
          actorId: owner,
          ...fence(ownerBuild),
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
        const build = await claimBuild(database, actorId)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          ...fence(build),
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
            ...fence(build),
            version: 1,
            tiles: [tile('16:3:3')]
          })
        ).toBe(false)
      })

      it('removes the row and the tiles inside one transaction', async () => {
        // Either order as two separate statements leaves a window a concurrent
        // build writes into; holding the row's lock for both is what closes it,
        // and only a real transaction holds it.
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
        await isolated.migrate()

        try {
          const actorId = await createActor(isolated)
          const build = await claimBuild(isolated, actorId)
          await isolated.upsertFitnessRouteHeatmapTiles({
            actorId,
            ...fence(build),
            version: build.version,
            tiles: [tile('16:2:2')]
          })
          const statements = recordStatements(instance)

          await isolated.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
            actorId
          })

          expectOneTransaction(
            statements,
            (sql) =>
              /^delete/i.test(sql) &&
              sql.includes('fitness_route_heatmap_pyramids'),
            (sql) =>
              /^delete/i.test(sql) &&
              sql.includes('fitness_route_heatmap_tiles')
          )
        } finally {
          await isolated.destroy()
        }
      })

      it('leaves another actor pyramid and tiles alone', async () => {
        const owner = await createActor(database)
        const other = await createActor(database)
        const ownerBuild = await claimBuild(database, owner)
        const otherBuild = await claimBuild(database, other)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: owner,
          ...fence(ownerBuild),
          version: 1,
          tiles: [tile('16:8:8')]
        })
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: other,
          ...fence(otherBuild),
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
        const {
          database: isolated,
          instance,
          prepare: prepareIsolated
        } = getTestDatabaseWithInstance(true)
        await prepareIsolated()
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
