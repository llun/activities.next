import crypto from 'crypto'
import FitParser from 'fit-file-parser'

import { UploadedFitFile } from '@/lib/types/domain/fitFile'
import { CreateFitnessActivityParams } from '@/lib/types/domain/fitnessActivity'

interface ParsedFitSession {
  start_time?: string
  sport?: string
  sub_sport?: string
  total_distance?: number
  total_timer_time?: number
  total_elapsed_time?: number
  total_ascent?: number
  avg_speed?: number
  max_speed?: number
  avg_heart_rate?: number
  max_heart_rate?: number
  avg_cadence?: number
  avg_power?: number
  total_calories?: number
}

interface ParsedFitData {
  sessions?: ParsedFitSession[]
}

interface ParseFitFileToFitnessActivityParams {
  actorId: string
  statusId: string
  fitFile: UploadedFitFile
}

const getNumber = (value: unknown): number | null => {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null
  return value
}

const getInteger = (value: unknown): number | null => {
  const parsed = getNumber(value)
  if (parsed === null) return null
  return Math.round(parsed)
}

const getDate = (value?: string): Date => {
  if (!value) return new Date()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return new Date()
  return date
}

const toTitleCase = (value: string): string => {
  return value
    .split('_')
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(' ')
}

const getActivityType = (sport?: string): string => {
  switch ((sport ?? '').toLowerCase()) {
    case 'running':
      return 'Run'
    case 'walking':
      return 'Walk'
    case 'hiking':
      return 'Hike'
    case 'cycling':
      return 'Ride'
    case 'e_biking':
      return 'EBikeRide'
    case 'swimming':
      return 'Swim'
    case 'rowing':
      return 'Rowing'
    default:
      return 'Workout'
  }
}

const getActivityName = (fileName: string, activityType: string): string => {
  const stem = fileName.replace(/\.fit$/i, '').trim()
  if (stem.length === 0) return `FIT ${activityType}`
  const normalized = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

const getSyntheticActivityId = (
  actorId: string,
  statusId: string,
  fileName: string
): number => {
  const hash = crypto
    .createHash('sha256')
    .update(`${actorId}:${statusId}:${fileName}`)
    .digest('hex')
  const id = Number.parseInt(hash.slice(0, 12), 16)
  return id === 0 ? 1 : id
}

export const parseFitFileToFitnessActivity = async ({
  actorId,
  statusId,
  fitFile
}: ParseFitFileToFitnessActivityParams): Promise<CreateFitnessActivityParams> => {
  const fitBuffer = Buffer.from(fitFile.contentBase64, 'base64')
  if (!fitBuffer.length) {
    throw new Error('FIT file is empty')
  }

  const fitParser = new FitParser({
    force: true,
    mode: 'cascade',
    speedUnit: 'm/s',
    lengthUnit: 'm'
  })
  const parsed = (await fitParser.parseAsync(fitBuffer)) as ParsedFitData
  const session = parsed.sessions?.[0]
  if (!session) {
    throw new Error('No session found in FIT file')
  }

  const type = getActivityType(session.sport)
  const sportType = session.sub_sport
    ? toTitleCase(session.sub_sport)
    : session.sport
      ? toTitleCase(session.sport)
      : null

  return {
    id: crypto.randomUUID(),
    actorId,
    stravaActivityId: getSyntheticActivityId(actorId, statusId, fitFile.name),
    statusId,
    name: getActivityName(fitFile.name, type),
    type,
    sportType,
    startDate: getDate(session.start_time),
    timezone: null,
    distance: getNumber(session.total_distance),
    movingTime: getInteger(session.total_timer_time),
    elapsedTime: getInteger(session.total_elapsed_time),
    totalElevationGain: getNumber(session.total_ascent),
    averageSpeed: getNumber(session.avg_speed),
    maxSpeed: getNumber(session.max_speed),
    averageHeartrate: getNumber(session.avg_heart_rate),
    maxHeartrate: getNumber(session.max_heart_rate),
    averageCadence: getNumber(session.avg_cadence),
    averageWatts: getNumber(session.avg_power),
    calories: getNumber(session.total_calories),
    rawData: {
      source: 'fit-upload',
      fileName: fitFile.name,
      session
    }
  }
}
