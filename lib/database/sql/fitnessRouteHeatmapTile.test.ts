import {
  claimBuild,
  createActor,
  expectOneTransaction,
  fence,
  recordStatements,
  tile
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

    describe('tile flush fence and progress', () => {
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
