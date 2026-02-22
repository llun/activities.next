import crypto from 'crypto'
import { Knex } from 'knex'

import {
  CounterKey,
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FitnessFile,
  FitnessImportStatus,
  FitnessProcessingStatus,
  SQLFitnessFile
} from '@/lib/types/database/fitnessFile'

export interface CreateFitnessFileParams {
  actorId: string
  statusId?: string
  path: string
  fileName: string
  fileType: 'fit' | 'gpx' | 'tcx'
  mimeType: string
  bytes: number
  description?: string
  hasMapData?: boolean
  mapImagePath?: string
  importBatchId?: string
}

export interface UpdateFitnessFileActivityData {
  totalDistanceMeters?: number | null
  totalDurationSeconds?: number | null
  elevationGainMeters?: number | null
  activityType?: string | null
  activityStartTime?: Date | null
  privacyHomeLatitude?: number | null
  privacyHomeLongitude?: number | null
  privacyHideRadiusMeters?: number | null
  hasMapData?: boolean | null
  mapImagePath?: string | null
}

export interface GetFitnessFileParams {
  id: string
}

export interface GetFitnessFilesByActorParams {
  actorId: string
  limit?: number
  offset?: number
}

export interface GetFitnessFilesByIdsParams {
  fitnessFileIds: string[]
}

export interface GetFitnessFilesForAccountParams {
  accountId: string
  limit?: number
  page?: number
  maxCreatedAt?: number
}

export interface PaginatedFitnessFiles {
  items: FitnessFile[]
  total: number
}

export interface GetFitnessFileByStatusParams {
  statusId: string
}

export interface GetFitnessFilesByBatchIdParams {
  batchId: string
}

export interface DeleteFitnessFileParams {
  id: string
}

export interface GetFitnessStorageUsageForAccountParams {
  accountId: string
}

export interface FitnessFileDatabase {
  createFitnessFile(
    params: CreateFitnessFileParams
  ): Promise<FitnessFile | null>
  getFitnessFile(params: GetFitnessFileParams): Promise<FitnessFile | null>
  getFitnessFilesByIds(
    params: GetFitnessFilesByIdsParams
  ): Promise<FitnessFile[]>
  getFitnessFilesByActor(
    params: GetFitnessFilesByActorParams
  ): Promise<FitnessFile[]>
  getFitnessFilesWithStatusForAccount(
    params: GetFitnessFilesForAccountParams
  ): Promise<PaginatedFitnessFiles>
  getFitnessFileByStatus(
    params: GetFitnessFileByStatusParams
  ): Promise<FitnessFile | null>
  getFitnessFilesByBatchId(
    params: GetFitnessFilesByBatchIdParams
  ): Promise<FitnessFile[]>
  getFitnessFilesByStatus(
    params: GetFitnessFileByStatusParams
  ): Promise<FitnessFile[]>
  getFitnessStorageUsageForAccount(
    params: GetFitnessStorageUsageForAccountParams
  ): Promise<number>
  deleteFitnessFile(params: DeleteFitnessFileParams): Promise<boolean>
  updateFitnessFileStatus(
    fitnessFileId: string,
    statusId: string
  ): Promise<boolean>
  updateFitnessFileProcessingStatus(
    fitnessFileId: string,
    processingStatus: FitnessProcessingStatus
  ): Promise<boolean>
  updateFitnessFilesProcessingStatus(params: {
    fitnessFileIds: string[]
    processingStatus: FitnessProcessingStatus
  }): Promise<number>
  updateFitnessFileImportStatus(
    fitnessFileId: string,
    importStatus: FitnessImportStatus,
    importError?: string
  ): Promise<boolean>
  updateFitnessFilesImportStatus(params: {
    fitnessFileIds: string[]
    importStatus: FitnessImportStatus
    importError?: string
  }): Promise<number>
  updateFitnessFilePrimary(
    fitnessFileId: string,
    isPrimary: boolean
  ): Promise<boolean>
  assignFitnessFilesToImportedStatus(params: {
    fitnessFileIds: string[]
    primaryFitnessFileId: string
    statusId: string
  }): Promise<number>
  updateFitnessFileActivityData(
    fitnessFileId: string,
    data: UpdateFitnessFileActivityData
  ): Promise<boolean>
}

// Helper function to normalize bytes from database which can be number, string, or bigint
const normalizeBytes = (bytes: number | string | bigint): number => {
  return Number(bytes)
}

const normalizeOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

const parseSQLFitnessFile = (row: SQLFitnessFile): FitnessFile => ({
  id: row.id,
  actorId: row.actorId,
  statusId: row.statusId ?? undefined,
  path: row.path,
  fileName: row.fileName,
  fileType: row.fileType,
  mimeType: row.mimeType,
  bytes: normalizeBytes(row.bytes),
  description: row.description ?? undefined,
  hasMapData: Boolean(row.hasMapData),
  mapImagePath: row.mapImagePath ?? undefined,
  processingStatus: row.processingStatus ?? 'pending',
  isPrimary:
    row.isPrimary === null || row.isPrimary === undefined
      ? true
      : Boolean(row.isPrimary),
  importBatchId: row.importBatchId ?? undefined,
  importStatus: row.importStatus ?? undefined,
  importError: row.importError ?? undefined,
  totalDistanceMeters: normalizeOptionalNumber(row.totalDistanceMeters),
  totalDurationSeconds: normalizeOptionalNumber(row.totalDurationSeconds),
  elevationGainMeters: normalizeOptionalNumber(row.elevationGainMeters),
  activityType: row.activityType ?? undefined,
  activityStartTime: row.activityStartTime
    ? getCompatibleTime(row.activityStartTime)
    : undefined,
  privacyHomeLatitude: normalizeOptionalNumber(row.privacyHomeLatitude),
  privacyHomeLongitude: normalizeOptionalNumber(row.privacyHomeLongitude),
  privacyHideRadiusMeters: normalizeOptionalNumber(row.privacyHideRadiusMeters),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

export const FitnessFileSQLDatabaseMixin = (
  database: Knex
): FitnessFileDatabase => ({
  async createFitnessFile(params: CreateFitnessFileParams) {
    return database.transaction(async (trx) => {
      const actor = await trx('actors')
        .where('id', params.actorId)
        .select<{ accountId: string | null }>('accountId')
        .first()

      const currentTime = new Date()
      const id = crypto.randomUUID()

      const data: SQLFitnessFile = {
        id,
        actorId: params.actorId,
        statusId: params.statusId ?? null,
        path: params.path,
        fileName: params.fileName,
        fileType: params.fileType,
        mimeType: params.mimeType,
        bytes: params.bytes,
        description: params.description ?? null,
        hasMapData: params.hasMapData ?? false,
        mapImagePath: params.mapImagePath ?? null,
        isPrimary: true,
        importBatchId: params.importBatchId ?? null,
        importStatus: params.importBatchId ? 'pending' : null,
        importError: null,
        processingStatus: 'pending',
        totalDistanceMeters: null,
        totalDurationSeconds: null,
        elevationGainMeters: null,
        activityType: null,
        activityStartTime: null,
        privacyHomeLatitude: null,
        privacyHomeLongitude: null,
        privacyHideRadiusMeters: null,
        createdAt: currentTime,
        updatedAt: currentTime
      }

      await trx('fitness_files').insert(data)

      // Update counters
      if (actor?.accountId) {
        await increaseCounterValue(
          trx,
          CounterKey.fitnessUsage(actor.accountId),
          params.bytes
        )
        await increaseCounterValue(
          trx,
          CounterKey.totalFitness(actor.accountId),
          1
        )
      }

      return parseSQLFitnessFile(data)
    })
  },

  async getFitnessFile({ id }: GetFitnessFileParams) {
    const row = await database<SQLFitnessFile>('fitness_files')
      .where('id', id)
      .whereNull('deletedAt')
      .first()

    if (!row) return null
    return parseSQLFitnessFile(row)
  },

  async getFitnessFilesByIds({ fitnessFileIds }: GetFitnessFilesByIdsParams) {
    if (fitnessFileIds.length === 0) {
      return []
    }

    const rows = await database<SQLFitnessFile>('fitness_files')
      .whereIn('id', fitnessFileIds)
      .whereNull('deletedAt')

    const fileById = new Map(
      rows.map((row) => [row.id, parseSQLFitnessFile(row)])
    )

    return fitnessFileIds
      .map((fitnessFileId) => fileById.get(fitnessFileId))
      .filter((item): item is FitnessFile => Boolean(item))
  },

  async getFitnessFilesByActor({
    actorId,
    limit = 25,
    offset = 0
  }: GetFitnessFilesByActorParams) {
    const rows = await database<SQLFitnessFile>('fitness_files')
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(offset)

    return rows.map(parseSQLFitnessFile)
  },

  async getFitnessFilesWithStatusForAccount({
    accountId,
    limit = 100,
    page = 1,
    maxCreatedAt
  }: GetFitnessFilesForAccountParams): Promise<PaginatedFitnessFiles> {
    // Get total count from counter table for performance.
    const totalPromise = getCounterValue(
      database,
      CounterKey.totalFitness(accountId)
    )

    let itemsQuery = database<SQLFitnessFile>('fitness_files')
      .join('actors', 'fitness_files.actorId', 'actors.id')
      .where('actors.accountId', accountId)
      .whereNull('fitness_files.deletedAt')
      .select('fitness_files.*')
      .orderBy('fitness_files.createdAt', 'desc')

    if (maxCreatedAt) {
      itemsQuery = itemsQuery.where(
        'fitness_files.createdAt',
        '<',
        new Date(maxCreatedAt)
      )
    }

    const offset = (page - 1) * limit
    itemsQuery = itemsQuery.limit(limit).offset(offset)

    const [total, rows] = await Promise.all([totalPromise, itemsQuery])

    return {
      items: rows.map(parseSQLFitnessFile),
      total
    }
  },

  async getFitnessFileByStatus({ statusId }: GetFitnessFileByStatusParams) {
    const row = await database<SQLFitnessFile>('fitness_files')
      .where('statusId', statusId)
      .whereNull('deletedAt')
      .orderBy('isPrimary', 'desc')
      .orderBy('activityStartTime', 'asc')
      .orderBy('createdAt', 'asc')
      .first()

    if (!row) return null
    return parseSQLFitnessFile(row)
  },

  async getFitnessFilesByBatchId({ batchId }: GetFitnessFilesByBatchIdParams) {
    const rows = await database<SQLFitnessFile>('fitness_files')
      .where('importBatchId', batchId)
      .whereNull('deletedAt')
      .orderBy('createdAt', 'asc')

    return rows.map(parseSQLFitnessFile)
  },

  async getFitnessFilesByStatus({ statusId }: GetFitnessFileByStatusParams) {
    const rows = await database<SQLFitnessFile>('fitness_files')
      .where('statusId', statusId)
      .whereNull('deletedAt')
      .orderBy('isPrimary', 'desc')
      .orderBy('activityStartTime', 'asc')
      .orderBy('createdAt', 'asc')

    return rows.map(parseSQLFitnessFile)
  },

  async getFitnessStorageUsageForAccount({
    accountId
  }: GetFitnessStorageUsageForAccountParams): Promise<number> {
    return getCounterValue(database, CounterKey.fitnessUsage(accountId))
  },

  async deleteFitnessFile({ id }: DeleteFitnessFileParams) {
    return database.transaction(async (trx) => {
      const file = await trx<SQLFitnessFile>('fitness_files')
        .where('id', id)
        .whereNull('deletedAt')
        .first()

      if (!file) return false

      const actor = await trx('actors')
        .where('id', file.actorId)
        .select<{ accountId: string | null }>('accountId')
        .first()

      const currentTime = new Date()
      await trx('fitness_files').where('id', id).update({
        deletedAt: currentTime,
        updatedAt: currentTime
      })

      // Update counters
      if (actor?.accountId) {
        const bytes = normalizeBytes(file.bytes)
        await decreaseCounterValue(
          trx,
          CounterKey.fitnessUsage(actor.accountId),
          bytes
        )
        await decreaseCounterValue(
          trx,
          CounterKey.totalFitness(actor.accountId),
          1
        )
      }

      return true
    })
  },

  async updateFitnessFileStatus(fitnessFileId: string, statusId: string) {
    const result = await database('fitness_files')
      .where('id', fitnessFileId)
      .update({
        statusId,
        updatedAt: new Date()
      })

    return result > 0
  },

  async updateFitnessFileProcessingStatus(
    fitnessFileId: string,
    processingStatus: FitnessProcessingStatus
  ) {
    const result = await database('fitness_files')
      .where('id', fitnessFileId)
      .update({
        processingStatus,
        updatedAt: new Date()
      })

    return result > 0
  },

  async updateFitnessFilesProcessingStatus({
    fitnessFileIds,
    processingStatus
  }: {
    fitnessFileIds: string[]
    processingStatus: FitnessProcessingStatus
  }) {
    if (fitnessFileIds.length === 0) {
      return 0
    }

    return database('fitness_files')
      .whereIn('id', fitnessFileIds)
      .whereNull('deletedAt')
      .update({
        processingStatus,
        updatedAt: new Date()
      })
  },

  async updateFitnessFileImportStatus(
    fitnessFileId: string,
    importStatus: FitnessImportStatus,
    importError?: string
  ) {
    const result = await database('fitness_files')
      .where('id', fitnessFileId)
      .update({
        importStatus,
        importError: importError ?? null,
        updatedAt: new Date()
      })

    return result > 0
  },

  async updateFitnessFilesImportStatus({
    fitnessFileIds,
    importStatus,
    importError
  }: {
    fitnessFileIds: string[]
    importStatus: FitnessImportStatus
    importError?: string
  }) {
    if (fitnessFileIds.length === 0) {
      return 0
    }

    return database('fitness_files')
      .whereIn('id', fitnessFileIds)
      .whereNull('deletedAt')
      .update({
        importStatus,
        importError: importError ?? null,
        updatedAt: new Date()
      })
  },

  async updateFitnessFilePrimary(fitnessFileId: string, isPrimary: boolean) {
    const result = await database('fitness_files')
      .where('id', fitnessFileId)
      .update({
        isPrimary,
        updatedAt: new Date()
      })

    return result > 0
  },

  async assignFitnessFilesToImportedStatus({
    fitnessFileIds,
    primaryFitnessFileId,
    statusId
  }: {
    fitnessFileIds: string[]
    primaryFitnessFileId: string
    statusId: string
  }) {
    if (fitnessFileIds.length === 0) {
      return 0
    }

    return database('fitness_files')
      .whereIn('id', fitnessFileIds)
      .whereNull('deletedAt')
      .update({
        statusId,
        importStatus: 'completed',
        importError: null,
        isPrimary: database.raw('CASE WHEN id = ? THEN ? ELSE ? END', [
          primaryFitnessFileId,
          true,
          false
        ]),
        processingStatus: database.raw('CASE WHEN id = ? THEN ? ELSE ? END', [
          primaryFitnessFileId,
          'pending',
          'completed'
        ]),
        updatedAt: new Date()
      })
  },

  async updateFitnessFileActivityData(
    fitnessFileId: string,
    data: UpdateFitnessFileActivityData
  ) {
    const updateData: Record<string, unknown> = {
      updatedAt: new Date()
    }

    const numberFields: Array<
      keyof Pick<
        UpdateFitnessFileActivityData,
        | 'totalDistanceMeters'
        | 'totalDurationSeconds'
        | 'elevationGainMeters'
        | 'privacyHomeLatitude'
        | 'privacyHomeLongitude'
        | 'privacyHideRadiusMeters'
      >
    > = [
      'totalDistanceMeters',
      'totalDurationSeconds',
      'elevationGainMeters',
      'privacyHomeLatitude',
      'privacyHomeLongitude',
      'privacyHideRadiusMeters'
    ]

    for (const field of numberFields) {
      if (!(field in data)) continue
      const value = data[field]
      updateData[field] = typeof value === 'number' ? value : null
    }
    if ('activityType' in data) {
      updateData.activityType = data.activityType ?? null
    }
    if ('activityStartTime' in data) {
      updateData.activityStartTime = data.activityStartTime ?? null
    }
    if ('hasMapData' in data) {
      updateData.hasMapData = data.hasMapData ?? false
    }
    if ('mapImagePath' in data) {
      updateData.mapImagePath = data.mapImagePath ?? null
    }

    const result = await database('fitness_files')
      .where('id', fitnessFileId)
      .update(updateData)

    return result > 0
  }
})
