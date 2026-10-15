import { toFitnessFileRouteData } from '@/lib/database/domains/fitnessFileRouteData/rows'
import type {
  CreateFitnessFileRouteDataParams,
  DeleteFitnessFileRouteDataParams,
  GetFitnessFileRouteDataParams,
  UpsertFitnessFileRouteDataParams
} from '@/lib/database/domains/fitnessFileRouteData/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { forShare } from '@/lib/database/kysely/dialect'
import type {
  FitnessFileRouteData,
  FitnessFileRouteDataMetadata
} from '@/lib/types/database/fitnessFileRouteData'

export const createFitnessFileRouteData = (
  db: Db,
  {
    fitnessFileId,
    actorId,
    routeData,
    sourceVersion = 1
  }: CreateFitnessFileRouteDataParams
): Promise<FitnessFileRouteData> => {
  const currentTime = new Date()

  return inTransaction(db, async (trx) => {
    const parentFile = await forShare(
      trx,
      trx
        .selectFrom('fitness_files')
        .select('id')
        .where('id', '=', fitnessFileId)
        .where('deletedAt', 'is', null)
        .limit(1)
    ).executeTakeFirst()

    if (!parentFile) {
      throw new Error(
        `Cannot cache route data for missing or deleted fitness file: ${fitnessFileId}`
      )
    }

    await trx
      .insertInto('fitness_file_route_data')
      .values({
        fitnessFileId,
        actorId,
        routeData,
        sourceVersion,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict((oc) =>
        oc.column('fitnessFileId').doUpdateSet({
          actorId,
          routeData,
          sourceVersion,
          updatedAt: currentTime
        })
      )
      .execute()

    const row = await trx
      .selectFrom('fitness_file_route_data')
      .select([
        'fitnessFileId',
        'actorId',
        'sourceVersion',
        'createdAt',
        'updatedAt'
      ])
      .where('fitnessFileId', '=', fitnessFileId)
      .limit(1)
      .executeTakeFirst()

    if (!row) {
      throw new Error(
        `fitness_file_route_data row missing immediately after upsert: ${fitnessFileId}`
      )
    }

    return toFitnessFileRouteData({
      ...row,
      routeData
    })
  })
}

export const upsertFitnessFileRouteData = (
  db: Db,
  params: UpsertFitnessFileRouteDataParams
): Promise<FitnessFileRouteData> => createFitnessFileRouteData(db, params)

export const getFitnessFileRouteData = async (
  db: Db,
  { fitnessFileId }: GetFitnessFileRouteDataParams
): Promise<FitnessFileRouteData | null> => {
  const row = await db
    .selectFrom('fitness_file_route_data')
    .selectAll()
    .where('fitnessFileId', '=', fitnessFileId)
    .limit(1)
    .executeTakeFirst()

  if (!row) return null
  return toFitnessFileRouteData(row)
}

export const getFitnessFileRouteDataMetadata = async (
  db: Db,
  { fitnessFileId }: GetFitnessFileRouteDataParams
): Promise<FitnessFileRouteDataMetadata | null> => {
  const row = await db
    .selectFrom('fitness_file_route_data')
    .select([
      'fitnessFileId',
      'actorId',
      'sourceVersion',
      'createdAt',
      'updatedAt'
    ])
    .where('fitnessFileId', '=', fitnessFileId)
    .limit(1)
    .executeTakeFirst()

  if (!row) return null
  return {
    fitnessFileId: row.fitnessFileId,
    actorId: row.actorId,
    sourceVersion: Number(row.sourceVersion ?? 1),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export const deleteFitnessFileRouteData = async (
  db: Db,
  { fitnessFileId }: DeleteFitnessFileRouteDataParams
): Promise<boolean> => {
  const result = await db
    .deleteFrom('fitness_file_route_data')
    .where('fitnessFileId', '=', fitnessFileId)
    .executeTakeFirst()

  return Number(result.numDeletedRows) > 0
}

export const fitnessFileRouteDataQueries = {
  createFitnessFileRouteData,
  upsertFitnessFileRouteData,
  getFitnessFileRouteData,
  getFitnessFileRouteDataMetadata,
  deleteFitnessFileRouteData
}
