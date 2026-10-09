import { Knex } from 'knex'

import {
  createActor,
  expectOneTransaction,
  fence,
  recordStatements
} from '@/lib/database/sql/fitnessRouteHeatmapTileTestHelpers'
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

    describe('claimFitnessRouteHeatmapPyramidBuild', () => {
      describe('carrying the claim decision into the compare-and-swap itself', () => {
        // Asserted on the statement issued rather than on an outcome, because
        // the interleaving this guards against — the owner heartbeating or
        // completing between this claim's read and its write — cannot be
        // staged deterministically from a single-threaded test. What can be
        // pinned is that the UPDATE re-tests the state the decision was made
        // on instead of trusting the token alone; without that clause the
        // read's verdict is a snapshot the write never rechecks.
        let isolated: ReturnType<typeof getTestDatabaseWithInstance>['database']
        let actorId: string
        const updates: string[] = []

        beforeEach(async () => {
          const {
            database: isolatedDatabase,
            instance,
            prepare: prepareIsolated
          } = getTestDatabaseWithInstance(true)
          isolated = isolatedDatabase
          await prepareIsolated()
          await isolated.migrate()

          actorId = await createActor(isolated)
          updates.length = 0
          instance.on('query', ({ sql }: { sql: string }) => {
            if (
              sql.includes('fitness_route_heatmap_pyramids') &&
              sql.trimStart().toLowerCase().startsWith('update')
            ) {
              updates.push(sql)
            }
          })
        })

        afterEach(async () => {
          await isolated.destroy()
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

        it('guards a fresh claim on the row, the token and the freshness state, but not the cursor', async () => {
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
        })

        it('guards a resume claim on both cursor columns and the build status', async () => {
          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          expect(claim.claimed).toBe(true)

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
        })

        it('drops the cursor premise when a claim presenting no token takes over a stale build', async () => {
          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          expect(claim.claimed).toBe(true)
          await isolated.updateFitnessRouteHeatmapPyramid({
            actorId,
            ...fence(claim.pyramid),
            cursor: { createdAt: 1_700_000_000_000, id: 'activity-42' }
          })

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
        })
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
          const statements = recordStatements(instance)

          const claim = await isolated.claimFitnessRouteHeatmapPyramidBuild({
            actorId,
            requestedAt: Date.now(),
            staleBefore: Date.now() - 120_000
          })
          expect(claim.claimed).toBe(true)

          const isPyramid = (sql: string) =>
            sql.includes('fitness_route_heatmap_pyramids')
          // The compare-and-swap and the read that confirms it, on one
          // connection inside one open transaction — the shared helper, rather
          // than a second copy of it that could drift from the guard it carries.
          expectOneTransaction(
            statements,
            (sql) => isPyramid(sql) && /^update/i.test(sql),
            (sql) => isPyramid(sql) && /^select/i.test(sql)
          )

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
    })
  })
})
