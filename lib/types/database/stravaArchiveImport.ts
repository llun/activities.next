export type StravaArchiveImportStatus =
  | 'importing'
  | 'failed'
  | 'completed'
  | 'cancelled'

export interface StravaArchivePendingMediaActivity {
  fitnessFileId: string
  activityId: string
  activityName?: string
  mediaPaths: string[]
}

export interface SQLStravaArchiveImport {
  id: string
  actorId: string
  archiveId: string
  archiveFitnessFileId: string
  batchId: string
  visibility: 'public' | 'unlisted' | 'private' | 'direct'
  status: StravaArchiveImportStatus
  nextActivityIndex: number
  pendingMediaActivities?: string | null
  mediaAttachmentRetry: number
  totalActivitiesCount?: number | null
  completedActivitiesCount: number
  failedActivitiesCount: number
  firstFailureMessage?: string | null
  lastError?: string | null
  resolvedAt?: number | Date | null
  createdAt: number | Date
  updatedAt: number | Date
}

export interface StravaArchiveImport {
  id: string
  actorId: string
  archiveId: string
  archiveFitnessFileId: string
  batchId: string
  visibility: 'public' | 'unlisted' | 'private' | 'direct'
  status: StravaArchiveImportStatus
  nextActivityIndex: number
  pendingMediaActivities: StravaArchivePendingMediaActivity[]
  mediaAttachmentRetry: number
  totalActivitiesCount?: number
  completedActivitiesCount: number
  failedActivitiesCount: number
  firstFailureMessage?: string
  lastError?: string
  resolvedAt?: number
  createdAt: number
  updatedAt: number
}
