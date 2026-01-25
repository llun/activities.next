import { Knex } from 'knex'

export interface FitnessFile {
  id: string
  actorId: string
  statusId: string | null
  provider: string
  providerId: string
  activityType: string | null
  filePath: string
  iconPath: string
  fileBytes: number
  iconBytes: number
  createdAt: Date
  updatedAt: Date
}

export interface CreateFitnessFileParams {
  id: string
  actorId: string
  statusId?: string
  provider: string
  providerId: string
  activityType?: string
  filePath: string
  iconPath: string
  fileBytes: number
  iconBytes: number
}

export interface GetFitnessFileParams {
  provider: string
  providerId: string
  actorId: string
}

export interface GetFitnessFilesForActorParams {
  actorId: string
  limit?: number
  offset?: number
}

export interface DeleteFitnessFileParams {
  id: string
  actorId: string
}

export interface GetFitnessStorageUsageParams {
  actorId: string
}

export interface FitnessFileDatabase {
  createFitnessFile(params: CreateFitnessFileParams): Promise<FitnessFile>
  getFitnessFile(params: GetFitnessFileParams): Promise<FitnessFile | null>
  getFitnessFilesForActor(
    params: GetFitnessFilesForActorParams
  ): Promise<FitnessFile[]>
  deleteFitnessFile(params: DeleteFitnessFileParams): Promise<boolean>
  getFitnessStorageUsage(params: GetFitnessStorageUsageParams): Promise<number>
}

export const FitnessFileSQLDatabaseMixin = (
  database: Knex
): FitnessFileDatabase => ({
  async createFitnessFile(params: CreateFitnessFileParams) {
    const currentTime = new Date()

    await database('fitness_files').insert({
      id: params.id,
      actorId: params.actorId,
      statusId: params.statusId || null,
      provider: params.provider,
      providerId: params.providerId,
      activityType: params.activityType || null,
      filePath: params.filePath,
      iconPath: params.iconPath,
      fileBytes: params.fileBytes,
      iconBytes: params.iconBytes,
      createdAt: currentTime,
      updatedAt: currentTime
    })

    const file = await database<FitnessFile>('fitness_files')
      .where({
        provider: params.provider,
        providerId: params.providerId,
        actorId: params.actorId
      })
      .first()

    if (!file) {
      throw new Error('Failed to create fitness file')
    }

    return file
  },

  async getFitnessFile(params: GetFitnessFileParams) {
    const file = await database<FitnessFile>('fitness_files')
      .where({
        provider: params.provider,
        providerId: params.providerId,
        actorId: params.actorId
      })
      .first()

    return file || null
  },

  async getFitnessFilesForActor(params: GetFitnessFilesForActorParams) {
    const query = database<FitnessFile>('fitness_files')
      .where('actorId', params.actorId)
      .orderBy('createdAt', 'desc')

    if (params.limit) {
      query.limit(params.limit)
    }
    if (params.offset) {
      query.offset(params.offset)
    }

    return query
  },

  async deleteFitnessFile(params: DeleteFitnessFileParams) {
    const deleted = await database('fitness_files')
      .where({
        id: params.id,
        actorId: params.actorId
      })
      .delete()

    return deleted > 0
  },

  async getFitnessStorageUsage(params: GetFitnessStorageUsageParams) {
    const result = await database('fitness_files')
      .where('actorId', params.actorId)
      .sum({ fileTotal: 'fileBytes', iconTotal: 'iconBytes' })
      .first()

    const fileTotal = result?.fileTotal ? Number(result.fileTotal) : 0
    const iconTotal = result?.iconTotal ? Number(result.iconTotal) : 0
    return fileTotal + iconTotal
  }
})
