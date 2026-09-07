import { ApiRequestError, parseApiError } from '@/lib/client/http'
import { uploadFileToPresignedUrl } from '@/lib/client/media'
import type { MastodonVisibility } from '@/lib/utils/getVisibility'

export interface UploadFitnessFileResult {
  id: string
  type: 'fitness'
  file_type: 'fit' | 'gpx' | 'tcx' | 'zip'
  mime_type: string
  url: string
  fileName: string
  size: number
  description?: string
  hasMapData?: boolean
  mapImageUrl?: string
}

export interface FitnessImportBatchFile {
  id: string
  actorId: string
  fileName: string
  fileType: 'fit' | 'gpx' | 'tcx' | 'zip'
  statusId: string | null
  isPrimary: boolean
  importStatus: 'pending' | 'completed' | 'failed'
  importError: string | null
  activityStartTime: number | null
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
}

export interface FitnessImportBatchResult {
  batchId: string
  status: 'pending' | 'completed' | 'failed' | 'partially_failed'
  summary: {
    total: number
    pending: number
    completed: number
    failed: number
  }
  files: FitnessImportBatchFile[]
}

export interface StartFitnessImportResult {
  batchId: string
  fileCount: number
}

export interface StartStravaArchiveImportResult {
  archiveId: string
  batchId: string
  importId: string
}

export interface ActiveStravaArchiveImport {
  id: string
  archiveId: string
  archiveFitnessFileId: string
  batchId: string
  visibility: MastodonVisibility
  status: 'importing' | 'failed'
  nextActivityIndex: number
  mediaAttachmentRetry: number
  totalActivitiesCount: number | null
  completedActivitiesCount: number
  failedActivitiesCount: number
  firstFailureMessage: string | null
  lastError: string | null
  pendingMediaActivitiesCount: number
  createdAt: number
  updatedAt: number
}

export interface ActiveStravaArchiveImportResponse {
  activeImport: ActiveStravaArchiveImport | null
}

export const uploadFitnessFile = async (
  file: File,
  description?: string
): Promise<UploadFitnessFileResult> => {
  const formData = new FormData()
  formData.append('file', file)
  if (description) {
    formData.append('description', description)
  }

  const response = await fetch('/api/v1/fitness-files', {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to upload fitness file.'
    )

    throw new Error(
      `Failed to upload fitness file: ${response.status} ${errorDetails}`
    )
  }

  return response.json()
}

export const startFitnessImport = async (
  files: File[],
  visibility: MastodonVisibility
): Promise<StartFitnessImportResult> => {
  const formData = new FormData()
  files.forEach((file) => {
    formData.append('files', file)
  })
  formData.append('visibility', visibility)

  const response = await fetch('/api/v1/fitness/import', {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to import fitness files.'
    )
    throw new Error(
      `Failed to import fitness files: ${response.status} ${errorDetails}`
    )
  }

  return response.json()
}

export interface StravaArchivePresignedResult {
  presigned: {
    url: string
    fitnessFileId: string
    archiveId: string
  }
}

export const createStravaArchivePresignedUrl = async (
  archive: File
): Promise<StravaArchivePresignedResult | null> => {
  const response = await fetch('/api/v1/fitness/strava/archive/presigned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: archive.name,
      contentType: archive.type || 'application/zip',
      size: archive.size
    })
  })
  if (response.status === 404) return null
  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to get presigned URL for archive'
    )
    throw new ApiRequestError(
      `Failed to get presigned URL for archive: ${response.status} ${errorDetails}`,
      response.status
    )
  }
  return response.json()
}

export const startStravaArchiveImport = async (
  archive: File,
  visibility: MastodonVisibility
): Promise<StartStravaArchiveImportResult> => {
  // Try presigned upload first (ObjectStorage/S3 backends)
  let presignedResult: StravaArchivePresignedResult | null = null
  try {
    presignedResult = await createStravaArchivePresignedUrl(archive)
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      error.status >= 400 &&
      error.status < 500
    ) {
      throw error
    }
  }

  if (presignedResult) {
    const { url, fitnessFileId, archiveId } = presignedResult.presigned

    try {
      // Upload archive directly to ObjectStorage via presigned PUT.
      await uploadFileToPresignedUrl({ presignedUrl: url, media: archive })
    } catch {
      // Presigned PUT failed (e.g. CORS not configured on the bucket).
      // Fall through to the server-side upload path below.
      presignedResult = null
    }

    if (presignedResult) {
      // Notify server to create import record and queue the job
      const response = await fetch('/api/v1/fitness/strava/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fitnessFileId, archiveId, visibility })
      })
      if (!response.ok) {
        throw new Error('Failed to start Strava archive import')
      }
      return response.json()
    }
  }

  // Fallback: upload archive through the Next.js server (LocalFile storage)
  const formData = new FormData()
  formData.append('archive', archive)
  formData.append('visibility', visibility)

  const response = await fetch('/api/v1/fitness/strava/archive', {
    method: 'POST',
    body: formData
  })
  if (!response.ok) {
    throw new Error('Failed to start Strava archive import')
  }
  return response.json()
}

export const getActiveStravaArchiveImport =
  async (): Promise<ActiveStravaArchiveImportResponse> => {
    const response = await fetch('/api/v1/fitness/strava/archive', {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    })

    if (!response.ok) {
      const errorDetails = await parseApiError(
        response,
        'Failed to load Strava archive import state.'
      )
      throw new Error(errorDetails)
    }

    return response.json()
  }

export const retryStravaArchiveImport = async (): Promise<{
  success: boolean
  activeImport: ActiveStravaArchiveImport | null
}> => {
  const response = await fetch('/api/v1/fitness/strava/archive', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'retry' })
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to retry Strava archive import.'
    )
    throw new Error(errorDetails)
  }

  return response.json()
}

export const cancelStravaArchiveImport = async (): Promise<{
  success: boolean
  cancelled: boolean
}> => {
  const response = await fetch('/api/v1/fitness/strava/archive', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'cancel' })
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to cancel Strava archive import.'
    )
    throw new Error(errorDetails)
  }

  return response.json()
}
