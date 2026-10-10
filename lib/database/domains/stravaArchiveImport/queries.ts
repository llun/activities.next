import { type Selectable, type Updateable } from 'kysely'
import crypto from 'node:crypto'

import type {
  CreateStravaArchiveImportParams,
  UpdateStravaArchiveImportParams
} from '@/lib/database/domains/stravaArchiveImport/types'
import type { Db } from '@/lib/database/kysely'
import type { EpochMs, StravaArchiveImports } from '@/lib/database/kysely/db'
import {
  StravaArchiveImport,
  StravaArchiveImportStatus,
  StravaArchivePendingMediaActivity
} from '@/lib/types/database/stravaArchiveImport'

type Row = Selectable<StravaArchiveImports>

const parsePendingMediaActivities = (
  value: Row['pendingMediaActivities']
): StravaArchivePendingMediaActivity[] => {
  if (!value) {
    return []
  }

  try {
    // A text column holding a JSON array; the driver hands it back as stored.
    const parsed: unknown = JSON.parse(value)
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

const parseRow = (row: Row): StravaArchiveImport => ({
  id: row.id,
  actorId: row.actorId,
  archiveId: row.archiveId,
  archiveFitnessFileId: row.archiveFitnessFileId,
  batchId: row.batchId,
  visibility: row.visibility as StravaArchiveImport['visibility'],
  status: row.status as StravaArchiveImportStatus,
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
  resolvedAt: row.resolvedAt ?? undefined,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
})

export const createStravaArchiveImport = async (
  db: Db,
  {
    id = crypto.randomUUID(),
    actorId,
    archiveId,
    archiveFitnessFileId,
    batchId,
    visibility
  }: CreateStravaArchiveImportParams
): Promise<StravaArchiveImport> => {
  const now = new Date()

  const row: Row = {
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
    // What the driver reads back for the stored timestamps.
    createdAt: now.getTime() as EpochMs,
    updatedAt: now.getTime() as EpochMs
  }

  await db
    .insertInto('strava_archive_imports')
    .values({ ...row, resolvedAt: null, createdAt: now, updatedAt: now })
    .execute()

  return parseRow(row)
}

export const getStravaArchiveImportById = async (
  db: Db,
  { id }: { id: string }
): Promise<StravaArchiveImport | null> => {
  const row = await db
    .selectFrom('strava_archive_imports')
    .selectAll()
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()

  return row ? parseRow(row) : null
}

export const getStravaArchiveImportByBatchId = async (
  db: Db,
  { batchId }: { batchId: string }
): Promise<StravaArchiveImport | null> => {
  const row = await db
    .selectFrom('strava_archive_imports')
    .selectAll()
    .where('batchId', '=', batchId)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst()

  return row ? parseRow(row) : null
}

export const getActiveStravaArchiveImportByActor = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<StravaArchiveImport | null> => {
  const row = await db
    .selectFrom('strava_archive_imports')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('resolvedAt', 'is', null)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst()

  return row ? parseRow(row) : null
}

export const updateStravaArchiveImport = async (
  db: Db,
  {
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
  }: UpdateStravaArchiveImportParams
): Promise<StravaArchiveImport | null> => {
  const updateData: Updateable<StravaArchiveImports> = {
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

  const { numUpdatedRows } = await db
    .updateTable('strava_archive_imports')
    .set(updateData)
    .where('id', '=', id)
    .executeTakeFirst()

  if (Number(numUpdatedRows) <= 0) {
    return null
  }

  const row = await db
    .selectFrom('strava_archive_imports')
    .selectAll()
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()

  return row ? parseRow(row) : null
}

export const deleteStravaArchiveImport = async (
  db: Db,
  { id }: { id: string }
): Promise<boolean> => {
  const { numDeletedRows } = await db
    .deleteFrom('strava_archive_imports')
    .where('id', '=', id)
    .executeTakeFirst()

  return Number(numDeletedRows) > 0
}

export const stravaArchiveImportQueries = {
  createStravaArchiveImport,
  getStravaArchiveImportById,
  getStravaArchiveImportByBatchId,
  getActiveStravaArchiveImportByActor,
  updateStravaArchiveImport,
  deleteStravaArchiveImport
}
