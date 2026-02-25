import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  SQLStravaArchiveImport,
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
  getActiveStravaArchiveImportByActor(params: {
    actorId: string
  }): Promise<StravaArchiveImport | null>
  updateStravaArchiveImport(
    params: UpdateStravaArchiveImportParams
  ): Promise<StravaArchiveImport | null>
  deleteStravaArchiveImport(params: { id: string }): Promise<boolean>
}

const parsePendingMediaActivities = (
  value: SQLStravaArchiveImport['pendingMediaActivities']
): StravaArchivePendingMediaActivity[] => {
  if (!value) {
    return []
  }

  try {
    const parsed = getCompatibleJSON<unknown>(value)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null
        }

        const rawItem = item as Record<string, unknown>
        const fitnessFileId = String(rawItem.fitnessFileId ?? '').trim()
        const activityId = String(rawItem.activityId ?? '').trim()
        const mediaPaths = Array.isArray(rawItem.mediaPaths)
          ? rawItem.mediaPaths
              .map((path) => String(path ?? '').trim())
              .filter((path) => path.length > 0)
          : []

        if (
          fitnessFileId.length === 0 ||
          activityId.length === 0 ||
          mediaPaths.length === 0
        ) {
          return null
        }

        const activityNameRaw = rawItem.activityName
        const activityName =
          typeof activityNameRaw === 'string' &&
          activityNameRaw.trim().length > 0
            ? activityNameRaw.trim()
            : undefined

        return {
          fitnessFileId,
          activityId,
          ...(activityName ? { activityName } : null),
          mediaPaths
        }
      })
      .filter(
        (item): item is StravaArchivePendingMediaActivity => item !== null
      )
  } catch {
    return []
  }
}

const parseRow = (row: SQLStravaArchiveImport): StravaArchiveImport => ({
  id: row.id,
  actorId: row.actorId,
  archiveId: row.archiveId,
  archiveFitnessFileId: row.archiveFitnessFileId,
  batchId: row.batchId,
  visibility: row.visibility,
  status: row.status,
  nextActivityIndex: row.nextActivityIndex,
  pendingMediaActivities: parsePendingMediaActivities(
    row.pendingMediaActivities
  ),
  mediaAttachmentRetry: row.mediaAttachmentRetry,
  totalActivitiesCount: row.totalActivitiesCount ?? undefined,
  completedActivitiesCount: row.completedActivitiesCount,
  failedActivitiesCount: row.failedActivitiesCount,
  firstFailureMessage: row.firstFailureMessage ?? undefined,
  lastError: row.lastError ?? undefined,
  resolvedAt: row.resolvedAt ? getCompatibleTime(row.resolvedAt) : undefined,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const StravaArchiveImportSQLDatabaseMixin = (
  database: Knex
): StravaArchiveImportDatabase => ({
  async createStravaArchiveImport({
    id = crypto.randomUUID(),
    actorId,
    archiveId,
    archiveFitnessFileId,
    batchId,
    visibility
  }: CreateStravaArchiveImportParams): Promise<StravaArchiveImport> {
    const now = new Date()

    const row: SQLStravaArchiveImport = {
      id,
      actorId,
      archiveId,
      archiveFitnessFileId,
      batchId,
      visibility,
      status: 'importing',
      nextActivityIndex: 0,
      pendingMediaActivities: null,
      mediaAttachmentRetry: 0,
      totalActivitiesCount: null,
      completedActivitiesCount: 0,
      failedActivitiesCount: 0,
      firstFailureMessage: null,
      lastError: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now
    }

    await database<SQLStravaArchiveImport>('strava_archive_imports').insert(row)

    return parseRow(row)
  },

  async getStravaArchiveImportById({ id }: { id: string }) {
    const row = await database<SQLStravaArchiveImport>('strava_archive_imports')
      .where({ id })
      .first()

    if (!row) {
      return null
    }

    return parseRow(row)
  },

  async getActiveStravaArchiveImportByActor({ actorId }: { actorId: string }) {
    const row = await database<SQLStravaArchiveImport>('strava_archive_imports')
      .where({ actorId })
      .whereNull('resolvedAt')
      .orderBy('createdAt', 'desc')
      .first()

    if (!row) {
      return null
    }

    return parseRow(row)
  },

  async updateStravaArchiveImport({
    id,
    archiveFitnessFileId,
    status,
    nextActivityIndex,
    pendingMediaActivities,
    mediaAttachmentRetry,
    totalActivitiesCount,
    completedActivitiesCount,
    failedActivitiesCount,
    firstFailureMessage,
    lastError,
    resolvedAt
  }: UpdateStravaArchiveImportParams) {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date()
    }

    if (archiveFitnessFileId !== undefined) {
      updateData.archiveFitnessFileId = archiveFitnessFileId
    }
    if (status !== undefined) {
      updateData.status = status
    }
    if (nextActivityIndex !== undefined) {
      updateData.nextActivityIndex = nextActivityIndex
    }
    if (pendingMediaActivities !== undefined) {
      updateData.pendingMediaActivities = JSON.stringify(pendingMediaActivities)
    }
    if (mediaAttachmentRetry !== undefined) {
      updateData.mediaAttachmentRetry = mediaAttachmentRetry
    }
    if (totalActivitiesCount !== undefined) {
      updateData.totalActivitiesCount = totalActivitiesCount
    }
    if (completedActivitiesCount !== undefined) {
      updateData.completedActivitiesCount = completedActivitiesCount
    }
    if (failedActivitiesCount !== undefined) {
      updateData.failedActivitiesCount = failedActivitiesCount
    }
    if (firstFailureMessage !== undefined) {
      updateData.firstFailureMessage = firstFailureMessage
    }
    if (lastError !== undefined) {
      updateData.lastError = lastError
    }
    if (resolvedAt !== undefined) {
      updateData.resolvedAt = resolvedAt ? new Date(resolvedAt) : null
    }

    const updatedCount = await database<SQLStravaArchiveImport>(
      'strava_archive_imports'
    )
      .where({ id })
      .update(updateData)

    if (updatedCount <= 0) {
      return null
    }

    const row = await database<SQLStravaArchiveImport>('strava_archive_imports')
      .where({ id })
      .first()

    if (!row) {
      return null
    }

    return parseRow(row)
  },

  async deleteStravaArchiveImport({ id }: { id: string }) {
    const deletedCount = await database<SQLStravaArchiveImport>(
      'strava_archive_imports'
    )
      .where({ id })
      .delete()

    return deletedCount > 0
  }
})
