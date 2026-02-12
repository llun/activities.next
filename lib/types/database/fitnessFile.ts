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

  createdAt: number
  updatedAt: number
  deletedAt?: number | null
}
