import type { Mock } from 'vitest'
import { afterAll, beforeAll, beforeEach, expect, vi } from 'vitest'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME } from '@/lib/jobs/names'
import { getFitnessFile } from '@/lib/services/fitness-files'
import {
  FITNESS_FILE_ROUTE_SOURCE_VERSION,
  buildFitnessFileRoutePoints
} from '@/lib/services/fitness-files/fileRouteCache'
import { TILE_LADDER_ZOOMS } from '@/lib/services/fitness-files/heatmapTiles/constants'
import {
  isParseableFitnessFileType,
  parseFitnessFile
} from '@/lib/services/fitness-files/parseFitnessFile'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { Actor } from '@/lib/types/domain/actor'

import { generateFitnessRouteHeatmapJob } from './generateFitnessRouteHeatmapJob'

// Shared by the generateFitnessRouteHeatmapJob suites. Each suite repeats the
// `vi.mock` calls (they are hoisted per test file); they also apply to this
// module.
export const mockGetFitnessFile = getFitnessFile as jest.MockedFunction<
  typeof getFitnessFile
>
export const mockParseFitnessFile = parseFitnessFile as jest.MockedFunction<
  typeof parseFitnessFile
>
export const mockIsParseableFitnessFileType =
  isParseableFitnessFileType as jest.MockedFunction<
    typeof isParseableFitnessFileType
  >

export const useHeatmapJobFixtures = ({
  mockPublish
}: {
  mockPublish: Mock
}) => {
  // Not `getTestSQLDatabase`: that one is SQLite-only and ignores
  // `TEST_DATABASE_TYPE`, so this suite reported a clean run under the pg
  // environment variables for three review rounds without ever opening a
  // PostgreSQL connection. Everything here drives real SQL — the claim's
  // compare-and-swap, the tiles-and-progress transaction, the fenced sweep —
  // and all of it has to agree on both backends.
  const {
    database,
    instance,
    prepare: prepareDatabase
  } = getTestDatabaseWithInstance()

  // The scan pages `ORDER BY createdAt DESC, id DESC`, and several tests here
  // depend on which fixture is scanned first. Two `createCompletedFitnessFile`
  // calls routinely land in the same millisecond on an in-memory database, and
  // the tie then breaks on a random UUID — a coin flip that was failing runs.
  // Stamping a distinct `createdAt` per fixture makes the order the tests
  // assume an actual property of the rows rather than a race they usually win.
  const FIXTURE_CREATED_AT_BASE = Date.UTC(2026, 0, 1)
  let fixtureSequence = 0
  let actor: Actor

  beforeAll(async () => {
    await prepareDatabase()
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor
  })

  afterAll(async () => {
    await database.destroy()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockPublish.mockResolvedValue(undefined)
    mockIsParseableFitnessFileType.mockReturnValue(true)
    mockGetFitnessFile.mockResolvedValue({
      type: 'buffer',
      buffer: Buffer.from('fitness-file-bytes'),
      contentType: 'application/vnd.ant.fit'
    })
    mockParseFitnessFile.mockResolvedValue({
      coordinates: [
        { lat: 52.36, lng: 4.88 },
        { lat: 52.37, lng: 4.89 }
      ],
      trackPoints: [
        { lat: 52.36, lng: 4.88 },
        { lat: 52.37, lng: 4.89 }
      ],
      totalDistanceMeters: 1_250,
      totalDurationSeconds: 420,
      elevationGainMeters: 42,
      activityType: 'running',
      startTime: new Date('2026-04-15T07:00:00.000Z')
    })
    if (actor?.id) {
      await instance('fitness_route_heatmaps')
        .where('actorId', actor.id)
        .delete()
    }
  })

  const createCompletedFitnessFile = async (
    activityType: string,
    activityStartTime: Date
  ) => {
    const postId = `route-heatmap-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
    const statusId = `${actor.id}/statuses/${postId}`

    await database.createNote({
      id: statusId,
      url: `https://${actor.domain}/${actor.username}/${postId}`,
      actorId: actor.id,
      text: 'Test activity',
      summary: null,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actor.id}/followers`],
      reply: ''
    })

    const fitnessFile = await database.createFitnessFile({
      actorId: actor.id,
      statusId,
      path: `fitness/${postId}.fit`,
      fileName: `${postId}.fit`,
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 2_048
    })
    expect(fitnessFile).toBeDefined()

    await database.updateFitnessFileProcessingStatus(
      fitnessFile!.id,
      'completed'
    )
    await database.updateFitnessFilePrimary(fitnessFile!.id, true)
    await database.updateFitnessFileActivityData(fitnessFile!.id, {
      activityType,
      activityStartTime,
      hasMapData: true,
      mapImagePath: 'medias/test-map.webp'
    })

    fixtureSequence += 1
    await instance('fitness_files')
      .where('id', fitnessFile!.id)
      .update({
        createdAt: new Date(FIXTURE_CREATED_AT_BASE + fixtureSequence * 1_000)
      })

    return fitnessFile!.id
  }

  return {
    database,
    instance,
    getActor: () => actor,
    createCompletedFitnessFile
  }
}

export const createPyramidHelpers = ({
  database,
  getActor,
  mockPublish
}: {
  database: Database
  getActor: () => Actor
  mockPublish: Mock
}) => {
  // The pyramid and its tiles survive `deleteFitnessRouteHeatmapsForActor`,
  // which only soft-deletes the region rows — and every test in this file
  // shares one actor, so without this the next test inherits a completed
  // build and never claims one.
  const clearPyramid = () =>
    database.deleteFitnessRouteHeatmapPyramidAndTilesForActor({
      actorId: getActor().id
    })

  // `requestedAt` is a parameter rather than a `Date.now()` in the body
  // because a test that scripts `Date.now` would otherwise have this call eat
  // the first scripted value — the one the job reads as its `startedAt`.
  const runAllTime = (
    id: string,
    extra: Record<string, unknown> = {},
    requestedAt = Date.now()
  ) =>
    generateFitnessRouteHeatmapJob(database, {
      id,
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: {
        actorId: getActor().id,
        activityType: null,
        periodType: 'all_time',
        periodKey: 'all',
        requestedAt,
        ...extra
      }
    })

  // Three routes far enough apart that no two share a tile at any ladder
  // zoom, so a visit count above 1 anywhere can only mean something was
  // folded twice. Long enough to survive quantization at z4, where one pixel
  // is 9.8km.
  const AMSTERDAM = [
    { lat: 52.0, lng: 4.88 },
    { lat: 52.45, lng: 4.95 }
  ]
  const SINGAPORE = [
    { lat: 1.1, lng: 103.6 },
    { lat: 1.55, lng: 104.05 }
  ]
  const TOKYO = [
    { lat: 35.5, lng: 139.6 },
    { lat: 35.9, lng: 139.8 }
  ]

  // Seeding the route cache rather than mocking the parse keeps which file
  // gets which route independent of paging order.
  const seedRoute = (
    fitnessFileId: string,
    coordinates: Array<{ lat: number; lng: number }>
  ) =>
    database.upsertFitnessFileRoute({
      fitnessFileId,
      actorId: getActor().id,
      points: buildFitnessFileRoutePoints(coordinates),
      sourceVersion: FITNESS_FILE_ROUTE_SOURCE_VERSION
    })

  const readTiles = async () => {
    const rows = await Promise.all(
      TILE_LADDER_ZOOMS.map((z) =>
        database.getFitnessRouteHeatmapTilesInRange({
          actorId: getActor().id,
          z,
          minX: 0,
          maxX: 2 ** z - 1,
          minY: 0,
          maxY: 2 ** z - 1
        })
      )
    )
    return rows.flat()
  }

  /**
   * Replays the continuation the job just published for itself, exactly as
   * the queue would deliver it. Hand-building the payload instead would skip
   * whatever the checkpoint chose to carry forward — including the tile
   * build's ownership token, without which the continuation reads its own
   * predecessor's fresh heartbeat as somebody else's live build.
   */
  const runPublishedContinuation = async (id: string) => {
    expect(mockPublish).toHaveBeenCalledTimes(1)
    const continuation = mockPublish.mock.calls[0][0] as {
      data: Record<string, unknown>
    }
    mockPublish.mockClear()
    await generateFitnessRouteHeatmapJob(database, {
      id,
      name: GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
      data: continuation.data
    })
    return continuation.data
  }

  return {
    clearPyramid,
    runAllTime,
    seedRoute,
    readTiles,
    runPublishedContinuation,
    AMSTERDAM,
    SINGAPORE,
    TOKYO
  }
}
