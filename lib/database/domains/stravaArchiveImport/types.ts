// Parameter and result types of the Strava archive import domain. The stored
// and result shapes live in lib/types/database/stravaArchiveImport.ts.
import type {
  StravaArchiveImport,
  StravaArchiveImportStatus,
  StravaArchivePendingMediaActivity
} from '@/lib/types/database/stravaArchiveImport'

export interface CreateStravaArchiveImportParams {
  id?: string
  actorId: string
  archiveId: string
  archiveFitnessFileId: string
  batchId: string
  visibility: 'public' | 'unlisted' | 'private' | 'direct'
}

export interface UpdateStravaArchiveImportParams {
  id: string
  archiveFitnessFileId?: string
  status?: StravaArchiveImportStatus
  nextActivityIndex?: number
  pendingMediaActivities?: StravaArchivePendingMediaActivity[]
  mediaAttachmentRetry?: number
  totalActivitiesCount?: number | null
  completedActivitiesCount?: number
  failedActivitiesCount?: number
  firstFailureMessage?: string | null
  lastError?: string | null
  resolvedAt?: number | null
}

export interface StravaArchiveImportDatabase {
  createStravaArchiveImport(
    params: CreateStravaArchiveImportParams
  ): Promise<StravaArchiveImport>
  getStravaArchiveImportById(params: {
    id: string
  }): Promise<StravaArchiveImport | null>
  getStravaArchiveImportByBatchId(params: {
    batchId: string
  }): Promise<StravaArchiveImport | null>
  getActiveStravaArchiveImportByActor(params: {
    actorId: string
  }): Promise<StravaArchiveImport | null>
  updateStravaArchiveImport(
    params: UpdateStravaArchiveImportParams
  ): Promise<StravaArchiveImport | null>
  deleteStravaArchiveImport(params: { id: string }): Promise<boolean>
}
