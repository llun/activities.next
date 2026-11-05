export type FitnessBestEffortKind = 'power' | 'distance'

/** One best effort: `key` is seconds (power) or metres (distance). */
export interface FitnessBestEffortValue {
  kind: FitnessBestEffortKind
  key: number
  /** Watts for power, elapsed seconds for distance. */
  value: number
}

export interface StoredFitnessBestEffort extends FitnessBestEffortValue {
  fitnessFileId: string
}

/** The best stored effort for one (kind, key), with the activity it is from. */
export interface FitnessPersonalRecord extends StoredFitnessBestEffort {
  statusId: string
  activityDate: number
  activityType: string | null
  description: string | null
  fileName: string
}

export interface ReplaceFitnessBestEffortsParams {
  fitnessFileId: string
  actorId: string
  statusId: string
  activityType: string | null
  /** The activity's start time (epoch ms), else the file's upload time. */
  activityDate: number
  efforts: FitnessBestEffortValue[]
}

export interface GetFitnessBestEffortsParams {
  fitnessFileIds: string[]
}

export interface GetFitnessPersonalRecordsParams {
  actorId: string
  /** Only activities on or after this instant (epoch ms); all time when unset. */
  since?: number | null
}

export interface FitnessBestEffortDatabase {
  replaceFitnessBestEfforts(
    params: ReplaceFitnessBestEffortsParams
  ): Promise<void>
  getFitnessBestEfforts(
    params: GetFitnessBestEffortsParams
  ): Promise<StoredFitnessBestEffort[]>
  getFitnessPersonalRecords(
    params: GetFitnessPersonalRecordsParams
  ): Promise<FitnessPersonalRecord[]>
}
