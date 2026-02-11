import crypto from 'crypto'
import { Knex } from 'knex'

import {
  CounterKey,
  decreaseCounterValue,
  increaseCounterValue
} from '@/lib/database/sql/utils/counter'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  FitnessFile,
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
}

export interface GetFitnessFileParams {
  id: string
}

export interface GetFitnessFilesByActorParams {
  actorId: string
  limit?: number
  offset?: number
}

export interface GetFitnessFileByStatusParams {
  statusId: string
}

export interface DeleteFitnessFileParams {
  id: string
}

export interface FitnessFileDatabase {
  createFitnessFile(params: CreateFitnessFileParams): Promise<FitnessFile | null>
  getFitnessFile(params: GetFitnessFileParams): Promise<FitnessFile | null>
  getFitnessFilesByActor(
    params: GetFitnessFilesByActorParams
  ): Promise<FitnessFile[]>
  getFitnessFileByStatus(
    params: GetFitnessFileByStatusParams
  ): Promise<FitnessFile | null>
  deleteFitnessFile(params: DeleteFitnessFileParams): Promise<boolean>
  updateFitnessFileStatus(
    fitnessFileId: string,
    statusId: string
  ): Promise<boolean>
}

const parseSQLFitnessFile = (row: SQLFitnessFile): FitnessFile => ({
  id: row.id,
  actorId: row.actorId,
  statusId: row.statusId ?? undefined,
  path: row.path,
  fileName: row.fileName,
  fileType: row.fileType,
  mimeType: row.mimeType,
  bytes: typeof row.bytes === 'bigint' ? Number(row.bytes) : Number(row.bytes),
  description: row.description ?? undefined,
  hasMapData: row.hasMapData ?? false,
  mapImagePath: row.mapImagePath ?? undefined,
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

  async getFitnessFileByStatus({ statusId }: GetFitnessFileByStatusParams) {
    const row = await database<SQLFitnessFile>('fitness_files')
      .where('statusId', statusId)
      .whereNull('deletedAt')
      .first()

    if (!row) return null
    return parseSQLFitnessFile(row)
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
        const bytes =
          typeof file.bytes === 'bigint' ? Number(file.bytes) : file.bytes
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
  }
})
