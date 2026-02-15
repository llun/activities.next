import { XMLParser } from 'fast-xml-parser'
import FitParser from 'fit-file-parser'
import type { FitData } from 'fit-file-parser'
import { z } from 'zod'

export interface FitnessCoordinate {
  lat: number
  lng: number
}

interface FitnessTrackPoint extends FitnessCoordinate {
  altitudeMeters?: number
  timestamp?: Date
}

export interface FitnessActivityData {
  coordinates: FitnessCoordinate[]
  totalDistanceMeters: number
  totalDurationSeconds: number
  elevationGainMeters?: number
  activityType?: string
  startTime?: Date
}

export interface ParseFitnessFileParams {
  fileType: 'fit' | 'gpx' | 'tcx'
  buffer: Buffer
}

const XML_OPTIONS = {
  attributeNamePrefix: '',
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true
}

const EARTH_RADIUS_METERS = 6_371_000

const NumberLikeSchema = z.union([z.number(), z.string()])
const DateLikeSchema = z.union([z.number(), z.string(), z.date()])

const GpxPointSchema = z
  .object({
    lat: NumberLikeSchema.optional(),
    lon: NumberLikeSchema.optional(),
    ele: NumberLikeSchema.optional(),
    time: DateLikeSchema.optional()
  })
  .passthrough()

const GpxSegmentSchema = z
  .object({
    trkpt: z.union([GpxPointSchema, z.array(GpxPointSchema)]).optional()
  })
  .passthrough()

const GpxTrackSchema = z
  .object({
    type: z.string().optional(),
    trkseg: z.union([GpxSegmentSchema, z.array(GpxSegmentSchema)]).optional()
  })
  .passthrough()

const GpxSchema = z
  .object({
    gpx: z
      .object({
        metadata: z
          .object({
            time: DateLikeSchema.optional()
          })
          .passthrough()
          .optional(),
        trk: z.union([GpxTrackSchema, z.array(GpxTrackSchema)]).optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

const TcxTrackPointSchema = z
  .object({
    Time: DateLikeSchema.optional(),
    AltitudeMeters: NumberLikeSchema.optional(),
    Position: z
      .object({
        LatitudeDegrees: NumberLikeSchema.optional(),
        LongitudeDegrees: NumberLikeSchema.optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

const TcxTrackSchema = z
  .object({
    Trackpoint: z
      .union([TcxTrackPointSchema, z.array(TcxTrackPointSchema)])
      .optional()
  })
  .passthrough()

const TcxLapSchema = z
  .object({
    TotalTimeSeconds: NumberLikeSchema.optional(),
    DistanceMeters: NumberLikeSchema.optional(),
    Track: z.union([TcxTrackSchema, z.array(TcxTrackSchema)]).optional()
  })
  .passthrough()

const TcxActivitySchema = z
  .object({
    Sport: z.string().optional(),
    Id: DateLikeSchema.optional(),
    Lap: z.union([TcxLapSchema, z.array(TcxLapSchema)]).optional()
  })
  .passthrough()

const TcxSchema = z
  .object({
    TrainingCenterDatabase: z
      .object({
        Activities: z
          .object({
            Activity: z
              .union([TcxActivitySchema, z.array(TcxActivitySchema)])
              .optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough()

const asArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

const toDate = (value: unknown): Date | undefined => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed
    }
  }

  return undefined
}

const semicirclesToDegrees = (value: number): number => value * (180 / 2 ** 31)

const normalizeLatitude = (value: unknown): number | undefined => {
  const numeric = toNumber(value)
  if (typeof numeric !== 'number') return undefined

  if (Math.abs(numeric) > 90) {
    const converted = semicirclesToDegrees(numeric)
    if (Math.abs(converted) <= 90) {
      return converted
    }
    return undefined
  }

  return numeric
}

const normalizeLongitude = (value: unknown): number | undefined => {
  const numeric = toNumber(value)
  if (typeof numeric !== 'number') return undefined

  if (Math.abs(numeric) > 180) {
    const converted = semicirclesToDegrees(numeric)
    if (Math.abs(converted) <= 180) {
      return converted
    }
    return undefined
  }

  return numeric
}

const haversineDistanceMeters = (
  first: FitnessCoordinate,
  second: FitnessCoordinate
): number => {
  const dLat = ((second.lat - first.lat) * Math.PI) / 180
  const dLng = ((second.lng - first.lng) * Math.PI) / 180
  const lat1 = (first.lat * Math.PI) / 180
  const lat2 = (second.lat * Math.PI) / 180

  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine))
}

const getDistanceFromCoordinates = (
  coordinates: FitnessCoordinate[]
): number => {
  if (coordinates.length < 2) return 0

  let distance = 0
  for (let i = 1; i < coordinates.length; i += 1) {
    distance += haversineDistanceMeters(coordinates[i - 1], coordinates[i])
  }
  return distance
}

const getElevationGain = (
  altitudes: Array<number | undefined>
): number | undefined => {
  let gain = 0
  let previous: number | undefined

  for (const altitude of altitudes) {
    if (typeof altitude !== 'number') continue
    if (typeof previous === 'number' && altitude > previous) {
      gain += altitude - previous
    }
    previous = altitude
  }

  if (gain <= 0) return undefined
  return gain
}

const getDurationSeconds = (
  startTime?: Date,
  endTime?: Date,
  fallback?: number
): number => {
  if (
    typeof fallback === 'number' &&
    Number.isFinite(fallback) &&
    fallback > 0
  ) {
    return fallback
  }

  if (startTime && endTime) {
    const seconds = (endTime.getTime() - startTime.getTime()) / 1000
    if (seconds > 0) {
      return seconds
    }
  }

  return 0
}

const toActivityData = ({
  points,
  totalDistanceMeters,
  totalDurationSeconds,
  elevationGainMeters,
  activityType,
  startTime
}: {
  points: FitnessTrackPoint[]
  totalDistanceMeters?: number
  totalDurationSeconds?: number
  elevationGainMeters?: number
  activityType?: string
  startTime?: Date
}): FitnessActivityData => {
  const coordinates = points.map(({ lat, lng }) => ({ lat, lng }))

  const distance =
    typeof totalDistanceMeters === 'number' && totalDistanceMeters > 0
      ? totalDistanceMeters
      : getDistanceFromCoordinates(coordinates)

  const timestamps = points
    .map((point) => point.timestamp)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())

  const duration = getDurationSeconds(
    timestamps[0],
    timestamps[timestamps.length - 1],
    totalDurationSeconds
  )

  const computedElevationGain = getElevationGain(
    points.map((point) => point.altitudeMeters)
  )

  return {
    coordinates,
    totalDistanceMeters: distance,
    totalDurationSeconds: duration,
    ...(typeof elevationGainMeters === 'number' && elevationGainMeters > 0
      ? { elevationGainMeters }
      : typeof computedElevationGain === 'number'
        ? { elevationGainMeters: computedElevationGain }
        : null),
    ...(activityType ? { activityType } : null),
    ...(startTime
      ? { startTime }
      : timestamps[0]
        ? { startTime: timestamps[0] }
        : null)
  }
}

const parseFit = async (buffer: Buffer): Promise<FitnessActivityData> => {
  const parser = new FitParser({
    force: true,
    mode: 'list'
  })

  const fitContent = Uint8Array.from(buffer).buffer

  const parsed = await new Promise<FitData>((resolve, reject) => {
    parser.parse(
      fitContent,
      (error: string | null | undefined, data?: unknown) => {
        if (error) {
          reject(new Error(error))
          return
        }

        if (!data || typeof data !== 'object') {
          reject(new Error('Invalid FIT file payload'))
          return
        }

        resolve(data as FitData)
      }
    )
  })

  const sessions = asArray(parsed.sessions)
  const records = asArray(parsed.records)
  const primarySession = sessions[0]

  const points = records
    .map((record) => {
      const lat = normalizeLatitude(record.position_lat)
      const lng = normalizeLongitude(record.position_long)

      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return null
      }

      return {
        lat,
        lng,
        altitudeMeters: toNumber(record.altitude),
        timestamp: toDate(record.timestamp)
      }
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)

  const recordDistanceSamples = records
    .map((record) => toNumber(record.distance))
    .filter((distance): distance is number => typeof distance === 'number')

  const distanceFromRecords =
    recordDistanceSamples.length > 0
      ? Math.max(...recordDistanceSamples)
      : undefined

  return toActivityData({
    points,
    totalDistanceMeters:
      toNumber(primarySession?.total_distance) ?? distanceFromRecords,
    totalDurationSeconds:
      toNumber(primarySession?.total_elapsed_time) ??
      toNumber(primarySession?.total_timer_time),
    elevationGainMeters: toNumber(primarySession?.total_ascent),
    activityType:
      typeof primarySession?.sport === 'string'
        ? primarySession.sport
        : typeof primarySession?.sub_sport === 'string'
          ? primarySession.sub_sport
          : undefined,
    startTime: toDate(primarySession?.start_time)
  })
}

const parseGpx = (buffer: Buffer): FitnessActivityData => {
  const xmlParser = new XMLParser(XML_OPTIONS)
  const parsedResult = GpxSchema.safeParse(
    xmlParser.parse(buffer.toString('utf-8'))
  )

  if (!parsedResult.success) {
    throw new Error('Invalid GPX file structure')
  }

  const tracks = asArray(parsedResult.data.gpx?.trk)
  const points = tracks
    .flatMap((track) => asArray(track.trkseg))
    .flatMap((segment) => asArray(segment.trkpt))
    .map((point) => {
      const lat = normalizeLatitude(point.lat)
      const lng = normalizeLongitude(point.lon)
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return null
      }

      return {
        lat,
        lng,
        altitudeMeters: toNumber(point.ele),
        timestamp: toDate(point.time)
      }
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)

  return toActivityData({
    points,
    activityType: tracks.find((track) => track.type)?.type,
    startTime: toDate(parsedResult.data.gpx?.metadata?.time)
  })
}

const parseTcx = (buffer: Buffer): FitnessActivityData => {
  const xmlParser = new XMLParser(XML_OPTIONS)
  const parsedResult = TcxSchema.safeParse(
    xmlParser.parse(buffer.toString('utf-8'))
  )

  if (!parsedResult.success) {
    throw new Error('Invalid TCX file structure')
  }

  const activities = asArray(
    parsedResult.data.TrainingCenterDatabase?.Activities?.Activity
  )
  const activity = activities[0]
  const laps = asArray(activity?.Lap)

  const points = laps
    .flatMap((lap) => asArray(lap.Track))
    .flatMap((track) => asArray(track.Trackpoint))
    .map((point) => {
      const lat = normalizeLatitude(point.Position?.LatitudeDegrees)
      const lng = normalizeLongitude(point.Position?.LongitudeDegrees)
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return null
      }

      return {
        lat,
        lng,
        altitudeMeters: toNumber(point.AltitudeMeters),
        timestamp: toDate(point.Time)
      }
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)

  const lapDurationSeconds = laps.reduce(
    (sum, lap) => sum + (toNumber(lap.TotalTimeSeconds) ?? 0),
    0
  )
  const lapDistanceMeters = laps.reduce(
    (sum, lap) => sum + (toNumber(lap.DistanceMeters) ?? 0),
    0
  )

  return toActivityData({
    points,
    totalDistanceMeters: lapDistanceMeters > 0 ? lapDistanceMeters : undefined,
    totalDurationSeconds:
      lapDurationSeconds > 0 ? lapDurationSeconds : undefined,
    activityType: activity?.Sport,
    startTime: toDate(activity?.Id)
  })
}

export const parseFitnessFile = async ({
  fileType,
  buffer
}: ParseFitnessFileParams): Promise<FitnessActivityData> => {
  switch (fileType) {
    case 'fit':
      return parseFit(buffer)
    case 'gpx':
      return parseGpx(buffer)
    case 'tcx':
      return parseTcx(buffer)
    default:
      throw new Error(`Unsupported fitness file type: ${fileType}`)
  }
}
