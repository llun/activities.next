export type FitnessProcessingStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'

// SQL row type for fitness_files table
export interface SQLFitnessFile {
  id: string
  actorId: string
  statusId?: string | null

  // File information
  path: string
  fileName: string
  fileType: 'fit' | 'gpx' | 'tcx'
  mimeType: string
  bytes: number | string | bigint

  // Optional description
  description?: string | null

  // Map data flags
  hasMapData?: boolean | null
  mapImagePath?: string | null
  processingStatus?: FitnessProcessingStatus | null
  totalDistanceMeters?: number | null
  totalDurationSeconds?: number | null
  elevationGainMeters?: number | null
  activityType?: string | null
  activityStartTime?: number | Date | string | null

  // Timestamps
  createdAt: number | Date
  updatedAt: number | Date
  deletedAt?: number | Date | null
}

// Parsed version for application use
export interface FitnessFile {
  id: string
  actorId: string
  statusId?: string | null

  path: string
  fileName: string
  fileType: 'fit' | 'gpx' | 'tcx'
  mimeType: string
  bytes: number

  description?: string
  hasMapData?: boolean
  mapImagePath?: string
  processingStatus?: FitnessProcessingStatus
  totalDistanceMeters?: number
  totalDurationSeconds?: number
  elevationGainMeters?: number
  activityType?: string
  activityStartTime?: number

  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}
