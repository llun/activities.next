import { XMLParser } from 'fast-xml-parser'
import FitParser from 'fit-file-parser'
import type { FitData } from 'fit-file-parser'
import { z } from 'zod'

import {
  FitnessActivityData,
  FitnessCoordinate,
  FitnessTrackPoint,
  toActivityData
} from '@/lib/services/fitness-files/activityData'
import { getBrandFromManufacturer } from '@/lib/utils/fitnessDeviceBrands'

export type { FitnessActivityData, FitnessCoordinate, FitnessTrackPoint }
export { toActivityData }

export type ParseableFitnessFileType = 'fit' | 'gpx' | 'tcx'

export interface ParseFitnessFileParams {
  fileType: ParseableFitnessFileType
  buffer: Buffer
}

export const isParseableFitnessFileType = (
  fileType: string
): fileType is ParseableFitnessFileType => {
  return fileType === 'fit' || fileType === 'gpx' || fileType === 'tcx'
}

const XML_OPTIONS = {
  attributeNamePrefix: '',
  ignoreAttributes: false,
  parseTagValue: true,
  trimValues: true
}

const NumberLikeSchema = z.union([z.number(), z.string()])
const DateLikeSchema = z.union([z.number(), z.string(), z.date()])

const GpxPointSchema = z
  .object({
    lat: NumberLikeSchema.optional(),
    lon: NumberLikeSchema.optional(),
    ele: NumberLikeSchema.optional(),
    time: DateLikeSchema.optional(),
    extensions: z.record(z.string(), z.any()).optional(),
    speed: NumberLikeSchema.optional()
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
      .optional(),
    HeartRateBpm: z
      .object({
        Value: NumberLikeSchema.optional()
      })
      .passthrough()
      .optional(),
    Extensions: z.record(z.string(), z.any()).optional()
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

const parseFit = async (buffer: Buffer): Promise<FitnessActivityData> => {
  const parser = new FitParser({
    force: true,
    mode: 'list',
    speedUnit: 'km/h'
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

  // Extract device info from device_infos (device_index 0 = primary recording device).
  // Do NOT fall back to deviceInfos[0] — other entries may be sensors (HR, power meter, etc.)
  const deviceInfos = asArray(parsed.device_infos)
  const primaryDevice = deviceInfos.find((d) => Number(d.device_index) === 0)

  let deviceManufacturer: string | undefined
  let deviceName: string | undefined

  if (primaryDevice) {
    const mfr = primaryDevice.manufacturer
    if (typeof mfr === 'number') {
      // Store canonical string alias when known (e.g. 1 → "garmin"), otherwise numeric string
      const brand = getBrandFromManufacturer(mfr)
      deviceManufacturer = brand?.key ?? mfr.toString()
    } else if (typeof mfr === 'string' && mfr.trim().length > 0) {
      deviceManufacturer = mfr.trim().toLowerCase()
    }

    const productName = primaryDevice.product_name
    if (typeof productName === 'string' && productName.trim().length > 0) {
      const brand = getBrandFromManufacturer(primaryDevice.manufacturer)
      const brandLabel = brand?.displayName ?? ''
      const trimmed = productName.trim()
      deviceName =
        brandLabel &&
        !trimmed.toLowerCase().startsWith(brandLabel.toLowerCase())
          ? `${brandLabel} ${trimmed}`
          : trimmed
    }
  }

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
        altitude: toNumber(record.altitude),
        timestamp: toDate(record.timestamp),
        power: toNumber(record.power),
        heartRate: toNumber(record.heart_rate),
        speed: toNumber(record.speed)
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

  const base = toActivityData({
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

  return {
    ...base,
    ...(deviceManufacturer ? { deviceManufacturer } : {}),
    ...(deviceName ? { deviceName } : {})
  }
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

      const tpx = point.extensions?.['gpxtpx:TrackPointExtension'] as any
      // gpxtpx:speed and point.speed are in m/s per the GPX spec; convert to km/h
      const speedMs = toNumber(tpx?.['gpxtpx:speed']) ?? toNumber(point.speed)
      return {
        lat,
        lng,
        altitudeMeters: toNumber(point.ele),
        altitude: toNumber(point.ele),
        timestamp: toDate(point.time),
        heartRate: toNumber(tpx?.['gpxtpx:hr']),
        speed: typeof speedMs === 'number' ? speedMs * 3.6 : undefined
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

  const rawTrackpoints = laps
    .flatMap((lap) => asArray(lap.Track))
    .flatMap((track) => asArray(track.Trackpoint))

  // GPS-only points for coordinates and map track (FitnessTrackPoint requires lat/lng)
  const gpsPoints = rawTrackpoints
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
        altitude: toNumber(point.AltitudeMeters),
        timestamp: toDate(point.Time),
        power: toNumber(point.Extensions?.['ns3:TPX']?.['ns3:Watts']),
        heartRate: toNumber(point.HeartRateBpm?.Value),
        // ns3:Speed is in m/s per the TCX schema; convert to km/h
        speed: (() => {
          const ms = toNumber(point.Extensions?.['ns3:TPX']?.['ns3:Speed'])
          return typeof ms === 'number' ? ms * 3.6 : undefined
        })()
      }
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)

  // Extract metric series from all trackpoints regardless of GPS presence
  // so indoor activities (no GPS) still get power/HR/speed data
  const powerSeries = rawTrackpoints
    .map((point) => toNumber(point.Extensions?.['ns3:TPX']?.['ns3:Watts']))
    .filter((v): v is number => typeof v === 'number')
  const heartRateSeries = rawTrackpoints
    .map((point) => toNumber(point.HeartRateBpm?.Value))
    .filter((v): v is number => typeof v === 'number')
  const speedSeries = rawTrackpoints
    .map((point) => {
      const ms = toNumber(point.Extensions?.['ns3:TPX']?.['ns3:Speed'])
      return typeof ms === 'number' ? ms * 3.6 : undefined
    })
    .filter((v): v is number => typeof v === 'number')
  const altitudeSeries = rawTrackpoints
    .map((point) => toNumber(point.AltitudeMeters))
    .filter((v): v is number => typeof v === 'number')

  const lapDurationSeconds = laps.reduce(
    (sum, lap) => sum + (toNumber(lap.TotalTimeSeconds) ?? 0),
    0
  )
  const lapDistanceMeters = laps.reduce(
    (sum, lap) => sum + (toNumber(lap.DistanceMeters) ?? 0),
    0
  )

  const base = toActivityData({
    points: gpsPoints,
    totalDistanceMeters: lapDistanceMeters > 0 ? lapDistanceMeters : undefined,
    totalDurationSeconds:
      lapDurationSeconds > 0 ? lapDurationSeconds : undefined,
    activityType: activity?.Sport,
    startTime: toDate(activity?.Id)
  })

  return {
    ...base,
    powerSeries: powerSeries.length > 0 ? powerSeries : base.powerSeries,
    heartRateSeries:
      heartRateSeries.length > 0 ? heartRateSeries : base.heartRateSeries,
    speedSeries: speedSeries.length > 0 ? speedSeries : base.speedSeries,
    altitudeSeries:
      altitudeSeries.length > 0 ? altitudeSeries : base.altitudeSeries
  }
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
