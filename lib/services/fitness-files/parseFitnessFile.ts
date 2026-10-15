import { XMLParser } from 'fast-xml-parser'
import FitParser from 'fit-file-parser'
import type { ParsedFit } from 'fit-file-parser'
import { z } from 'zod'

import {
  FitnessActivityData,
  FitnessCoordinate,
  FitnessLap,
  FitnessMetricPoint,
  FitnessTrackPoint,
  METRIC_POINT_KEYS,
  toActivityData
} from '@/lib/services/fitness-files/activityData'
import { getBrandFromManufacturer } from '@/lib/utils/fitnessDeviceBrands'

export type {
  FitnessActivityData,
  FitnessCoordinate,
  FitnessLap,
  FitnessMetricPoint,
  FitnessTrackPoint
}
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
    // Newly read fields are `unknown` so a value in an unexpected shape (for
    // example `<Cadence><Value>1</Value></Cadence>`) can never make a file that
    // parsed before fail validation; `toNumber` ignores what it cannot read.
    DistanceMeters: z.unknown().optional(),
    Cadence: z.unknown().optional(),
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
    // Newly read fields are `unknown` on purpose: an empty `<Extensions/>` or
    // `<AverageHeartRateBpm/>` parses to "" and must not make a file that
    // parsed before fail validation.
    StartTime: z.unknown().optional(),
    Calories: z.unknown().optional(),
    AverageHeartRateBpm: z.unknown().optional(),
    MaximumHeartRateBpm: z.unknown().optional(),
    Cadence: z.unknown().optional(),
    Extensions: z.unknown().optional(),
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Read a child element by trying several namespace-prefix spellings. Garmin and
 * third-party exporters bind the same extension namespace to different prefixes
 * (`ns3:`, `ns2:`, `gpxtpx:`, `tpx:`, or none), so a single literal key misses
 * valid files.
 */
const readPrefixed = (
  container: unknown,
  prefixes: readonly string[],
  name: string
): unknown => {
  if (!isRecord(container)) return undefined
  for (const prefix of prefixes) {
    const value = container[`${prefix}${name}`]
    if (value !== undefined) return value
  }
  return undefined
}

const TCX_EXTENSION_PREFIXES = ['ns3:', 'ns2:', 'tpx:', ''] as const
const GPX_EXTENSION_PREFIXES = ['gpxtpx:', 'ns3:', 'tpx:', ''] as const

const readTcxTpx = (extensions: unknown): unknown =>
  readPrefixed(extensions, TCX_EXTENSION_PREFIXES, 'TPX')

const readTcxTpxNumber = (extensions: unknown, name: string) =>
  toNumber(readPrefixed(readTcxTpx(extensions), TCX_EXTENSION_PREFIXES, name))

const readTcxLx = (extensions: unknown): unknown =>
  readPrefixed(extensions, TCX_EXTENSION_PREFIXES, 'LX')

/**
 * Normalize a FIT `left_right_balance` to the percentage of power from the LEFT
 * leg (0-100), or undefined when it cannot be known.
 *
 * fit-file-parser decodes the record field through its 8-bit
 * `left_right_balance` bitfield (mask 0x7F, flag 0x80 = `right`), so
 * `record.left_right_balance` arrives as `{ value, right }`. Per the FIT
 * profile the flag marks that `value` is the RIGHT leg's share, so the left
 * share is `100 - value`; without the flag the side is unknown and nothing is
 * returned. A raw number is split with the same bits. A raw number above 0xFF
 * is the 16-bit `left_right_balance_100` form (mask 0x3FFF, flag 0x8000),
 * whose value is in hundredths of a percent.
 */
const toLeftBalancePercent = (raw: unknown): number | undefined => {
  let value: number | undefined
  let right: boolean
  let scale = 1

  if (isRecord(raw)) {
    value = toNumber(raw.value)
    right = raw.right === true
  } else {
    const numeric = toNumber(raw)
    if (typeof numeric !== 'number') return undefined
    if (numeric > 0xff) {
      value = numeric & 0x3fff
      right = (numeric & 0x8000) !== 0
      scale = 100
    } else {
      value = numeric & 0x7f
      right = (numeric & 0x80) !== 0
    }
  }

  if (!right || typeof value !== 'number') return undefined
  const percent = value / scale
  if (percent < 0 || percent > 100) return undefined
  return Math.round((100 - percent) * 100) / 100
}

/**
 * Keep the samples that chart something. Used for files without a GPS track, so
 * these are the only per-sample data they have.
 */
const toMetricPoints = (
  points: FitnessMetricPoint[]
): FitnessMetricPoint[] | undefined => {
  const kept = points.filter((point) =>
    METRIC_POINT_KEYS.some((key) => point[key] !== undefined)
  )
  return kept.length > 0 ? kept : undefined
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

  const parsed = await new Promise<ParsedFit>((resolve, reject) => {
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

        resolve(data as ParsedFit)
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
        speed: toNumber(record.speed),
        cadence: toNumber(record.cadence),
        temperature: toNumber(record.temperature),
        leftRightBalance: toLeftBalancePercent(record.left_right_balance),
        // lengthUnit defaults to 'm', so record.distance is already meters.
        distanceMeters: toNumber(record.distance)
      }
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)

  // Only files without a GPS track need time-aligned samples; outdoor files
  // skip the extra per-record work (imports and heatmap jobs parse many files).
  const metricPoints =
    points.length === 0
      ? toMetricPoints(
          records.map((record) => ({
            timestamp: toDate(record.timestamp),
            distanceMeters: toNumber(record.distance),
            power: toNumber(record.power),
            heartRate: toNumber(record.heart_rate),
            cadence: toNumber(record.cadence),
            speed: toNumber(record.speed),
            altitude: toNumber(record.altitude),
            temperature: toNumber(record.temperature),
            leftRightBalance: toLeftBalancePercent(record.left_right_balance)
          }))
        )
      : undefined

  const recordDistanceSamples = records
    .map((record) => toNumber(record.distance))
    .filter((distance): distance is number => typeof distance === 'number')

  const distanceFromRecords =
    recordDistanceSamples.length > 0
      ? Math.max(...recordDistanceSamples)
      : undefined

  const powerSeries = records
    .map((record) => toNumber(record.power))
    .filter((v): v is number => typeof v === 'number')
  const heartRateSeries = records
    .map((record) => toNumber(record.heart_rate))
    .filter((v): v is number => typeof v === 'number')
  const altitudeSeries = records
    .map((record) => toNumber(record.altitude))
    .filter((v): v is number => typeof v === 'number')
  const speedSeries = records
    .map((record) => toNumber(record.speed))
    .filter((v): v is number => typeof v === 'number')

  const sessionAvgPower = toNumber(primarySession?.avg_power)
  const sessionMaxPower = toNumber(primarySession?.max_power)
  const sessionAvgHeartRate = toNumber(primarySession?.avg_heart_rate)
  const sessionMaxHeartRate = toNumber(primarySession?.max_heart_rate)
  const sessionTotalWork = toNumber(primarySession?.total_work)
  const sessionTotalWorkKj =
    typeof sessionTotalWork === 'number'
      ? Math.round(sessionTotalWork / 1000)
      : undefined

  let activityStart = toDate(primarySession?.start_time)
  if (!activityStart) {
    for (const record of records) {
      activityStart = toDate(record.timestamp)
      if (activityStart) break
    }
  }

  const laps = asArray(parsed.laps).flatMap((lap): FitnessLap[] => {
    const lapStart = toDate(lap.start_time)
    const durationSeconds =
      toNumber(lap.total_elapsed_time) ?? toNumber(lap.total_timer_time)
    if (!lapStart || !activityStart || typeof durationSeconds !== 'number') {
      return []
    }

    const avgPower = toNumber(lap.avg_power)
    const avgHeartRate = toNumber(lap.avg_heart_rate)
    const maxHeartRate = toNumber(lap.max_heart_rate)
    const avgCadence = toNumber(lap.avg_cadence)
    const avgSpeed = toNumber(lap.avg_speed ?? lap.enhanced_avg_speed)
    const elevationGainMeters = toNumber(lap.total_ascent)
    const calories = toNumber(lap.total_calories)
    return [
      {
        startElapsedSeconds: Math.max(
          0,
          (lapStart.getTime() - activityStart.getTime()) / 1000
        ),
        startTimestamp: lapStart.getTime(),
        durationSeconds,
        distanceMeters: toNumber(lap.total_distance) ?? 0,
        ...(avgPower !== undefined ? { avgPower } : null),
        ...(avgHeartRate !== undefined ? { avgHeartRate } : null),
        ...(maxHeartRate !== undefined ? { maxHeartRate } : null),
        ...(avgCadence !== undefined ? { avgCadence } : null),
        ...(avgSpeed !== undefined ? { avgSpeed } : null),
        ...(elevationGainMeters !== undefined ? { elevationGainMeters } : null),
        ...(calories !== undefined ? { calories } : null)
      }
    ]
  })

  const base = toActivityData({
    points,
    powerSeries: powerSeries.length > 0 ? powerSeries : undefined,
    heartRateSeries: heartRateSeries.length > 0 ? heartRateSeries : undefined,
    altitudeSeries: altitudeSeries.length > 0 ? altitudeSeries : undefined,
    speedSeries: speedSeries.length > 0 ? speedSeries : undefined,
    laps,
    metricPoints,
    calories: toNumber(primarySession?.total_calories),
    avgPower: sessionAvgPower,
    maxPower: sessionMaxPower,
    avgHeartRate: sessionAvgHeartRate,
    maxHeartRate: sessionMaxHeartRate,
    totalWorkKj: sessionTotalWorkKj,
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
  const rawPoints = tracks
    .flatMap((track) => asArray(track.trkseg))
    .flatMap((segment) => asArray(segment.trkpt))
    .map((point) => {
      const tpx = readPrefixed(
        point.extensions,
        GPX_EXTENSION_PREFIXES,
        'TrackPointExtension'
      )
      const readTpx = (name: string) =>
        toNumber(readPrefixed(tpx, GPX_EXTENSION_PREFIXES, name))
      // gpxtpx:speed and point.speed are in m/s per the GPX spec; convert to km/h
      const speedMs = readTpx('speed') ?? toNumber(point.speed)
      // Power has no standard GPX home: some exporters write <power> directly
      // under <extensions>, Garmin nests it in gpxpx:PowerExtension.
      const power =
        toNumber(point.extensions?.power) ??
        toNumber(
          readPrefixed(
            readPrefixed(point.extensions, ['gpxpx:'], 'PowerExtension'),
            ['gpxpx:'],
            'PowerInWatts'
          )
        )
      return {
        lat: normalizeLatitude(point.lat),
        lng: normalizeLongitude(point.lon),
        altitudeMeters: toNumber(point.ele),
        altitude: toNumber(point.ele),
        timestamp: toDate(point.time),
        heartRate: readTpx('hr'),
        speed: typeof speedMs === 'number' ? speedMs * 3.6 : undefined,
        power,
        cadence: readTpx('cad'),
        temperature: readTpx('atemp')
      }
    })

  const points = rawPoints
    .map(({ lat, lng, ...rest }) =>
      typeof lat === 'number' && typeof lng === 'number'
        ? { lat, lng, ...rest }
        : null
    )
    .filter((point): point is NonNullable<typeof point> => point !== null)

  // Only files without a GPS track need time-aligned samples.
  const metricPoints =
    points.length === 0
      ? toMetricPoints(
          rawPoints.map(
            ({
              lat: _lat,
              lng: _lng,
              altitudeMeters: _altitudeMeters,
              ...rest
            }) => rest
          )
        )
      : undefined

  return toActivityData({
    points,
    metricPoints,
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
        power: readTcxTpxNumber(point.Extensions, 'Watts'),
        heartRate: toNumber(point.HeartRateBpm?.Value),
        // ns3:Speed is in m/s per the TCX schema; convert to km/h
        speed: (() => {
          const ms = readTcxTpxNumber(point.Extensions, 'Speed')
          return typeof ms === 'number' ? ms * 3.6 : undefined
        })(),
        cadence:
          toNumber(point.Cadence) ??
          readTcxTpxNumber(point.Extensions, 'RunCadence'),
        distanceMeters: toNumber(point.DistanceMeters)
      }
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)

  // Extract metric series from all trackpoints regardless of GPS presence
  // so indoor activities (no GPS) still get power/HR/speed data
  const powerSeries = rawTrackpoints
    .map((point) => readTcxTpxNumber(point.Extensions, 'Watts'))
    .filter((v): v is number => typeof v === 'number')
  const heartRateSeries = rawTrackpoints
    .map((point) => toNumber(point.HeartRateBpm?.Value))
    .filter((v): v is number => typeof v === 'number')
  const speedSeries = rawTrackpoints
    .map((point) => {
      const ms = readTcxTpxNumber(point.Extensions, 'Speed')
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

  // Only files without a GPS track need time-aligned samples.
  const metricPoints =
    gpsPoints.length === 0
      ? toMetricPoints(
          rawTrackpoints.map((point) => {
            const speedMs = readTcxTpxNumber(point.Extensions, 'Speed')
            return {
              timestamp: toDate(point.Time),
              distanceMeters: toNumber(point.DistanceMeters),
              power: readTcxTpxNumber(point.Extensions, 'Watts'),
              heartRate: toNumber(point.HeartRateBpm?.Value),
              cadence:
                toNumber(point.Cadence) ??
                readTcxTpxNumber(point.Extensions, 'RunCadence'),
              speed: typeof speedMs === 'number' ? speedMs * 3.6 : undefined,
              altitude: toNumber(point.AltitudeMeters)
            }
          })
        )
      : undefined

  const activityStart =
    toDate(activity?.Id) ??
    laps.map((lap) => toDate(lap.StartTime)).find(Boolean)
  let elapsedBeforeLap = 0
  const fitnessLaps = laps.flatMap((lap): FitnessLap[] => {
    const durationSeconds = toNumber(lap.TotalTimeSeconds)
    if (typeof durationSeconds !== 'number') return []

    const lapStart = toDate(lap.StartTime)
    const startElapsedSeconds =
      lapStart && activityStart
        ? Math.max(0, (lapStart.getTime() - activityStart.getTime()) / 1000)
        : elapsedBeforeLap
    elapsedBeforeLap = startElapsedSeconds + durationSeconds

    const lx = readTcxLx(lap.Extensions)
    const avgSpeedMs = toNumber(
      readPrefixed(lx, TCX_EXTENSION_PREFIXES, 'AvgSpeed')
    )
    const avgPower = toNumber(
      readPrefixed(lx, TCX_EXTENSION_PREFIXES, 'AvgWatts')
    )
    const avgHeartRate = toNumber(
      readPrefixed(lap.AverageHeartRateBpm, [''], 'Value')
    )
    const maxHeartRate = toNumber(
      readPrefixed(lap.MaximumHeartRateBpm, [''], 'Value')
    )
    const avgCadence =
      toNumber(lap.Cadence) ??
      toNumber(readPrefixed(lx, TCX_EXTENSION_PREFIXES, 'AvgRunCadence'))
    const calories = toNumber(lap.Calories)
    return [
      {
        startElapsedSeconds,
        // TCX durations are timer time (TotalTimeSeconds), unlike FIT's elapsed.
        ...(lapStart ? { startTimestamp: lapStart.getTime() } : null),
        durationSeconds,
        distanceMeters: toNumber(lap.DistanceMeters) ?? 0,
        ...(avgPower !== undefined ? { avgPower } : null),
        ...(avgHeartRate !== undefined ? { avgHeartRate } : null),
        ...(maxHeartRate !== undefined ? { maxHeartRate } : null),
        ...(avgCadence !== undefined ? { avgCadence } : null),
        ...(typeof avgSpeedMs === 'number'
          ? { avgSpeed: avgSpeedMs * 3.6 }
          : null),
        ...(calories !== undefined ? { calories } : null)
      }
    ]
  })
  const lapCalories = laps.reduce(
    (sum, lap) => sum + (toNumber(lap.Calories) ?? 0),
    0
  )

  const base = toActivityData({
    points: gpsPoints,
    laps: fitnessLaps,
    metricPoints,
    calories: lapCalories > 0 ? lapCalories : undefined,
    powerSeries: powerSeries.length > 0 ? powerSeries : undefined,
    heartRateSeries: heartRateSeries.length > 0 ? heartRateSeries : undefined,
    speedSeries: speedSeries.length > 0 ? speedSeries : undefined,
    altitudeSeries: altitudeSeries.length > 0 ? altitudeSeries : undefined,
    totalDistanceMeters: lapDistanceMeters > 0 ? lapDistanceMeters : undefined,
    totalDurationSeconds:
      lapDurationSeconds > 0 ? lapDurationSeconds : undefined,
    activityType: activity?.Sport,
    startTime: toDate(activity?.Id)
  })

  return base
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
