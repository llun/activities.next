import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  FitnessActivityData,
  FitnessMetricPoint,
  FitnessTrackPoint
} from '@/lib/services/fitness-files/activityData'
import {
  MAX_CACHED_ROUTE_SAMPLE_POINTS,
  PRE_PARSED_ROUTE_DATA_VERSION,
  createPreParsedRouteDataPayload,
  hasPreParsedRouteData,
  loadPreParsedRouteData,
  resolveRouteDataFromPreParsed,
  savePreParsedRouteData
} from '@/lib/services/fitness-files/fileRouteDataCache'
import { FitnessPrivacyLocation } from '@/lib/services/fitness-files/privacy'
import { seedDatabase } from '@/lib/stub/database'
import { seedActor1 } from '@/lib/stub/seed/actor1'
import { FitnessFile } from '@/lib/types/database/fitnessFile'
import { Actor } from '@/lib/types/domain/actor'

describe('fileRouteDataCache', () => {
  const { database, prepare } = createTestDatabase()
  let actor: Actor
  let fitnessFile: FitnessFile

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await seedDatabase(database)
    actor = (await database.getActorFromUsername({
      username: seedActor1.username,
      domain: seedActor1.domain
    })) as Actor

    const file = await database.createFitnessFile({
      actorId: actor.id,
      path: 'fitness/cache-test.fit',
      fileName: 'cache-test.fit',
      fileType: 'fit',
      mimeType: 'application/vnd.ant.fit',
      bytes: 1024
    })
    fitnessFile = file!
  })

  afterAll(async () => {
    await database.destroy()
  })

  describe('createPreParsedRouteDataPayload', () => {
    it('rounds lat/lng to 5 decimals and metric values to required precision', () => {
      const trackPoints: FitnessTrackPoint[] = [
        {
          lat: 37.12345678,
          lng: -122.98765432,
          timestamp: new Date('2026-01-01T10:00:00.000Z'),
          altitude: 105.456,
          speed: 12.345,
          heartRate: 145.6,
          power: 210.4,
          cadence: 85.7,
          temperature: 18.25,
          leftRightBalance: 49.33,
          distanceMeters: 100.456
        },
        {
          lat: 37.12355555,
          lng: -122.98755555,
          timestamp: new Date('2026-01-01T10:00:05.000Z'),
          altitudeMeters: 108.99,
          speed: 14.19,
          heartRate: 150.1,
          power: 230.9,
          cadence: 90.1,
          temperature: 18.89,
          leftRightBalance: 50.12,
          distanceMeters: 125.876
        }
      ]

      const activityData: FitnessActivityData = {
        coordinates: trackPoints.map((p) => ({ lat: p.lat, lng: p.lng })),
        trackPoints,
        totalDistanceMeters: 125.876,
        totalDurationSeconds: 5,
        powerSeries: [210, 231],
        heartRateSeries: [146, 150],
        altitudeSeries: [105, 109],
        speedSeries: [12, 14],
        calories: 50,
        laps: [
          {
            startElapsedSeconds: 0,
            durationSeconds: 5,
            distanceMeters: 125.876
          }
        ]
      }

      const payload = createPreParsedRouteDataPayload(activityData)

      expect(payload.version).toBe(PRE_PARSED_ROUTE_DATA_VERSION)
      expect(payload.totalDurationSeconds).toBe(5)
      expect(payload.calories).toBe(50)
      expect(payload.laps).toHaveLength(1)
      expect(payload.powerSeries).toEqual([210, 231])
      expect(payload.routeSamples).toBeDefined()
      expect(payload.routeSamples).toHaveLength(2)

      const first = payload.routeSamples![0]
      expect(first.lat).toBe(37.12346)
      expect(first.lng).toBe(-122.98765)
      expect(first.elapsedSeconds).toBe(0)
      expect(first.altitude).toBe(105.5)
      expect(first.speed).toBe(12.3)
      expect(first.heartRate).toBe(146)
      expect(first.power).toBe(210)
      expect(first.cadence).toBe(86)
      expect(first.temperature).toBe(18.3)
      expect(first.leftRightBalance).toBe(49.3)
      expect(first.distanceMeters).toBe(100.5)

      const second = payload.routeSamples![1]
      expect(second.lat).toBe(37.12356)
      expect(second.lng).toBe(-122.98756)
      expect(second.elapsedSeconds).toBe(5)
      expect(second.altitude).toBe(109)
      expect(second.speed).toBe(14.2)
      expect(second.heartRate).toBe(150)
      expect(second.power).toBe(231)
      expect(second.cadence).toBe(90)
    })

    it('creates metricSamples for indoor activities without GPS trackPoints', () => {
      const metricPoints: FitnessMetricPoint[] = [
        {
          timestamp: new Date('2026-01-01T10:00:00.000Z'),
          heartRate: 130.6,
          power: 180.4,
          cadence: 80.2,
          speed: 25.44,
          distanceMeters: 50.88
        },
        {
          timestamp: new Date('2026-01-01T10:00:10.000Z'),
          heartRate: 135.2,
          power: 195.9,
          cadence: 82.8,
          speed: 27.66,
          distanceMeters: 105.22
        }
      ]

      const activityData: FitnessActivityData = {
        coordinates: [],
        trackPoints: [],
        metricPoints,
        totalDistanceMeters: 105.22,
        totalDurationSeconds: 10
      }

      const payload = createPreParsedRouteDataPayload(activityData)

      expect(payload.routeSamples).toBeUndefined()
      expect(payload.metricSamples).toBeDefined()
      expect(payload.metricSamples).toHaveLength(2)

      expect(payload.metricSamples![0]).toEqual({
        elapsedSeconds: 0,
        timestamp: new Date('2026-01-01T10:00:00.000Z').getTime(),
        heartRate: 131,
        power: 180,
        cadence: 80,
        speed: 25.4,
        distanceMeters: 50.9
      })
      expect(payload.metricSamples![1]).toEqual({
        elapsedSeconds: 10,
        timestamp: new Date('2026-01-01T10:00:10.000Z').getTime(),
        heartRate: 135,
        power: 196,
        cadence: 83,
        speed: 27.7,
        distanceMeters: 105.2
      })
    })
  })

  describe('savePreParsedRouteData and loadPreParsedRouteData', () => {
    it('saves and loads pre-parsed route data from database', async () => {
      const fitnessFileId = fitnessFile.id
      const actorId = actor.id

      const activityData: FitnessActivityData = {
        coordinates: [
          { lat: 37.77, lng: -122.42 },
          { lat: 37.78, lng: -122.41 }
        ],
        trackPoints: [
          {
            lat: 37.774929,
            lng: -122.419416,
            timestamp: new Date('2026-01-01T10:00:00.000Z'),
            altitude: 20.4,
            speed: 15.6,
            heartRate: 140
          },
          {
            lat: 37.784929,
            lng: -122.409416,
            timestamp: new Date('2026-01-01T10:05:00.000Z'),
            altitude: 25.8,
            speed: 18.2,
            heartRate: 155
          }
        ],
        totalDistanceMeters: 1500,
        totalDurationSeconds: 300,
        powerSeries: [200, 220]
      }

      await savePreParsedRouteData(database, {
        fitnessFileId,
        actorId,
        activityData
      })

      const loaded = await loadPreParsedRouteData(database, fitnessFileId)
      expect(loaded).not.toBeNull()
      expect(loaded!.version).toBe(PRE_PARSED_ROUTE_DATA_VERSION)
      expect(loaded!.totalDurationSeconds).toBe(300)
      expect(loaded!.powerSeries).toEqual([200, 220])
      expect(loaded!.routeSamples).toHaveLength(2)
      expect(loaded!.routeSamples![0].lat).toBe(37.77493)
      expect(loaded!.routeSamples![0].lng).toBe(-122.41942)
    })

    it('returns null on cache miss or invalid sourceVersion', async () => {
      expect(
        await loadPreParsedRouteData(database, 'non-existent-file')
      ).toBeNull()

      // Create a second fitness file to test version mismatch
      const secondFile = await database.createFitnessFile({
        actorId: actor.id,
        path: 'fitness/version-mismatch.fit',
        fileName: 'version-mismatch.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024
      })

      // Insert row with different sourceVersion
      await database.upsertFitnessFileRouteData({
        fitnessFileId: secondFile!.id,
        actorId: actor.id,
        routeData: JSON.stringify({ version: 999 }),
        sourceVersion: 999
      })

      expect(await loadPreParsedRouteData(database, secondFile!.id)).toBeNull()
    })

    it('accepts a pre-computed payload directly without re-computing', async () => {
      const preComputedFile = await database.createFitnessFile({
        actorId: actor.id,
        path: 'fitness/pre-computed.fit',
        fileName: 'pre-computed.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024
      })

      const payload = {
        version: PRE_PARSED_ROUTE_DATA_VERSION,
        totalDurationSeconds: 180,
        calories: 95
      }

      await savePreParsedRouteData(database, {
        fitnessFileId: preComputedFile!.id,
        actorId: actor.id,
        payload
      })

      const loaded = await loadPreParsedRouteData(database, preComputedFile!.id)
      expect(loaded).toEqual(payload)
      expect(await hasPreParsedRouteData(database, preComputedFile!.id)).toBe(
        true
      )
    })

    it('hasPreParsedRouteData returns false when row is missing or has a stale sourceVersion', async () => {
      expect(await hasPreParsedRouteData(database, 'missing-fitness-id')).toBe(
        false
      )

      const staleFile = await database.createFitnessFile({
        actorId: actor.id,
        path: 'fitness/stale-version.fit',
        fileName: 'stale-version.fit',
        fileType: 'fit',
        mimeType: 'application/vnd.ant.fit',
        bytes: 1024
      })

      await database.upsertFitnessFileRouteData({
        fitnessFileId: staleFile!.id,
        actorId: actor.id,
        routeData: JSON.stringify({
          version: PRE_PARSED_ROUTE_DATA_VERSION - 1,
          totalDurationSeconds: 60
        }),
        sourceVersion: PRE_PARSED_ROUTE_DATA_VERSION - 1
      })

      expect(await hasPreParsedRouteData(database, staleFile!.id)).toBe(false)
    })

    it('caps cached routeSamples at MAX_CACHED_ROUTE_SAMPLE_POINTS', () => {
      const totalPoints = MAX_CACHED_ROUTE_SAMPLE_POINTS + 500
      const trackPoints: FitnessTrackPoint[] = Array.from(
        { length: totalPoints },
        (_, index) => ({
          lat: 37.77 + index * 0.0001,
          lng: -122.42 + index * 0.0001
        })
      )
      const payload = createPreParsedRouteDataPayload({
        coordinates: [],
        trackPoints,
        totalDistanceMeters: 50_000,
        totalDurationSeconds: totalPoints
      })

      expect(payload.routeSamples).toHaveLength(MAX_CACHED_ROUTE_SAMPLE_POINTS)
      expect(payload.routeSamples![0].elapsedSeconds).toBe(0)
      expect(
        payload.routeSamples![payload.routeSamples!.length - 1].elapsedSeconds
      ).toBe(totalPoints)
    })
  })

  describe('resolveRouteDataFromPreParsed', () => {
    const preParsed = {
      version: PRE_PARSED_ROUTE_DATA_VERSION,
      totalDurationSeconds: 600,
      routeSamples: [
        {
          lat: 37.77,
          lng: -122.42,
          elapsedSeconds: 0,
          distanceMeters: 0,
          altitude: 10,
          speed: 15,
          heartRate: 130
        },
        {
          lat: 37.775,
          lng: -122.415,
          elapsedSeconds: 300,
          distanceMeters: 500,
          altitude: 15,
          speed: 18,
          heartRate: 145
        },
        {
          lat: 37.78,
          lng: -122.41,
          elapsedSeconds: 600,
          distanceMeters: 1000,
          altitude: 20,
          speed: 20,
          heartRate: 155
        }
      ],
      powerSeries: [150, 180, 200]
    }

    const privacyLocation: FitnessPrivacyLocation = {
      lat: 37.77,
      lng: -122.42,
      radiusMeters: 200
    }

    it('returns hidden segments flagged for owner', () => {
      const result = resolveRouteDataFromPreParsed(preParsed, {
        canViewHiddenZone: true,
        privacyLocations: [privacyLocation]
      })

      expect(result.totalDurationSeconds).toBe(600)
      expect(result.powerSeries).toEqual([150, 180, 200])
      expect(result.samples).toHaveLength(3)
      // First point is hidden by privacy
      expect(result.samples[0].isHiddenByPrivacy).toBe(true)
      expect(result.samples[0].distanceMeters).toBe(0)
      // Later points are unhidden
      expect(result.samples[1].isHiddenByPrivacy).toBe(false)
      expect(result.samples[2].isHiddenByPrivacy).toBe(false)
      // Segments include hidden
      expect(result.segments.some((s) => s.isHiddenByPrivacy)).toBe(true)
    })

    it('masks hidden segments and rebases distance for non-owner', () => {
      const result = resolveRouteDataFromPreParsed(preParsed, {
        canViewHiddenZone: false,
        privacyLocations: [privacyLocation]
      })

      expect(result.totalDurationSeconds).toBe(600)
      // Hidden segment is excluded from non-owner view
      expect(result.segments.every((s) => !s.isHiddenByPrivacy)).toBe(true)
      expect(result.samples.every((s) => !s.isHiddenByPrivacy)).toBe(true)
      // Distance is rebased from first visible sample (was 500m, now 0m)
      expect(result.samples[0].distanceMeters).toBe(0)
      expect(result.samples[1].distanceMeters).toBe(500)
    })

    it('resolves metricSamples for indoor activities', () => {
      const indoorPreParsed = {
        version: PRE_PARSED_ROUTE_DATA_VERSION,
        totalDurationSeconds: 120,
        metricSamples: [
          { elapsedSeconds: 0, power: 150, heartRate: 120 },
          { elapsedSeconds: 120, power: 170, heartRate: 135 }
        ]
      }

      const result = resolveRouteDataFromPreParsed(indoorPreParsed, {
        canViewHiddenZone: false,
        privacyLocations: []
      })

      expect(result.samples).toEqual([])
      expect(result.segments).toEqual([])
      expect(result.metricSamples).toHaveLength(2)
      expect(result.metricSamples![0].power).toBe(150)
    })
  })
})
