import {
  databaseBeforeAll,
  getTestDatabaseTable
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

      it('resumes an abandoned build without losing its version or cursor', async () => {
        const actorId = await createActor(database)
        const first = await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          version: first.pyramid.version,
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
          version: claim.pyramid.version,
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
          version: claim.pyramid.version,
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
          version: claim.pyramid.version,
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
          version: claim.pyramid.version,
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
          version: first.pyramid.version,
          scannedCount: 999
        })

        expect(applied).toBe(false)
        const pyramid = await database.getFitnessRouteHeatmapPyramid({
          actorId
        })
        expect(pyramid?.scannedCount).toBe(0)
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
          version: claim.pyramid.version,
          cursor: { createdAt: 1_700_000_000_000, id: 'activity-7' }
        })

        await database.updateFitnessRouteHeatmapPyramid({
          actorId,
          version: claim.pyramid.version,
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
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
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

      it('replaces a tile in place on re-flush', async () => {
        const actorId = await createActor(database)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          version: 1,
          tiles: [tile('12:5:5', 2)]
        })
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
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
        // Ten columns per row against SQLite's 999-variable ceiling means the
        // insert has to chunk at ~99 rows; 250 forces three statements.
        const tiles = Array.from({ length: 250 }, (_unused, index) =>
          tile(`14:${index}:0`, 2)
        )

        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
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

      it('reads more keys than SQLite allows bound variables in one statement', async () => {
        const actorId = await createActor(database)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          version: 1,
          tiles: [tile('10:1:1', 3)]
        })

        const padding = Array.from(
          { length: 1_200 },
          (_unused, index) => `10:${index + 100}:9`
        )
        const tiles = await database.getFitnessRouteHeatmapTilesByKeys({
          actorId,
          tileKeys: [...padding, '10:1:1']
        })
        expect(tiles.map((row) => row.tileKey)).toEqual(['10:1:1'])
      })

      it('does nothing for an empty flush or an empty key list', async () => {
        const actorId = await createActor(database)
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
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
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: owner,
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
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
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
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
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
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          version: 1,
          tiles: [tile('16:1:1'), tile('16:2:2')]
        })
        // The next build rewrites one of them and adds a new one; the tile only
        // the old build knew about is the activity that has since been deleted.
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
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
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: owner,
          version: 1,
          tiles: [tile('16:4:4')]
        })
        await database.upsertFitnessRouteHeatmapTiles({
          actorId: other,
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

    describe('deleteFitnessRouteHeatmapTilesForActor and pyramid cleanup', () => {
      it('removes every tile and the pyramid row for one actor', async () => {
        const actorId = await createActor(database)
        await database.claimFitnessRouteHeatmapPyramidBuild({
          actorId,
          requestedAt: Date.now(),
          staleBefore: Date.now() - 120_000
        })
        await database.upsertFitnessRouteHeatmapTiles({
          actorId,
          version: 1,
          tiles: [tile('16:8:8'), tile('16:9:9')]
        })

        expect(
          await database.deleteFitnessRouteHeatmapTilesForActor({ actorId })
        ).toBe(2)
        expect(
          await database.deleteFitnessRouteHeatmapPyramidForActor({ actorId })
        ).toBe(1)
        expect(
          await database.getFitnessRouteHeatmapPyramid({ actorId })
        ).toBeNull()
      })
    })
  })
})
