import { fitnessFileOverviewQueries } from '@/lib/database/domains/fitnessFile/overview'
import {
  toFitnessFile,
  withKnexPaging
} from '@/lib/database/domains/fitnessFile/rows'
import type {
  CountFitnessFilesByActorParams,
  GetFitnessFileByStatusParams,
  GetFitnessFileParams,
  GetFitnessFilesByActorParams,
  GetFitnessFilesByBatchIdParams,
  GetFitnessFilesByIdsParams,
  GetFitnessFilesForAccountParams,
  GetFitnessStorageUsageForAccountParams,
  PaginatedFitnessFiles
} from '@/lib/database/domains/fitnessFile/types'
import { fitnessFileWrites } from '@/lib/database/domains/fitnessFile/writes'
import type { Db } from '@/lib/database/kysely'
import { getCounterValue } from '@/lib/database/kysely/counter'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import { CounterKey } from '@/lib/database/utils/counter'
import type { FitnessFile } from '@/lib/types/database/fitnessFile'

// The fitness file reads. The writes are in ./writes.ts and the fitness
// overview's reads (summary, calendar, day details, time bounds and whether an
// actor has fitness data at all) in ./overview.ts.

export const getFitnessFile = async (
  db: Db,
  { id }: GetFitnessFileParams
): Promise<FitnessFile | null> => {
  const row = await db
    .selectFrom('fitness_files')
    .selectAll()
    .where('id', '=', id)
    .where('deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()

  return row ? toFitnessFile(row) : null
}

export const getFitnessFilesByIds = async (
  db: Db,
  { fitnessFileIds }: GetFitnessFilesByIdsParams
): Promise<FitnessFile[]> => {
  if (fitnessFileIds.length === 0) {
    return []
  }

  const rows = await db
    .selectFrom('fitness_files')
    .selectAll()
    .where('id', 'in', fitnessFileIds)
    .where('deletedAt', 'is', null)
    .execute()

  const fileById = new Map(rows.map((row) => [row.id, toFitnessFile(row)]))

  // In the order asked for, missing and deleted files left out.
  return fitnessFileIds
    .map((fitnessFileId) => fileById.get(fitnessFileId))
    .filter((item): item is FitnessFile => Boolean(item))
}

// The actor's files matching the filters a page read and a count share.
const fitnessFilesByActor = (
  db: Db,
  {
    actorId,
    processingStatus,
    isPrimary,
    activityType,
    startDate,
    endDate
  }: CountFitnessFilesByActorParams
) =>
  db
    .selectFrom('fitness_files')
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .$if(Boolean(processingStatus), (qb) =>
      qb.where('processingStatus', '=', processingStatus!)
    )
    .$if(isPrimary !== undefined, (qb) =>
      qb.where('isPrimary', '=', isPrimary!)
    )
    .$if(activityType !== undefined, (qb) =>
      activityType === null
        ? qb.where('activityType', 'is', null)
        : qb.where('activityType', '=', activityType!)
    )
    .$if(Boolean(startDate), (qb) =>
      qb.where('activityStartTime', '>=', timestampValue(startDate!))
    )
    .$if(Boolean(endDate), (qb) =>
      qb.where('activityStartTime', '<=', timestampValue(endDate!))
    )

export const getFitnessFilesByActor = async (
  db: Db,
  params: GetFitnessFilesByActorParams
): Promise<FitnessFile[]> => {
  const {
    limit = 25,
    offset = 0,
    orderDirection = 'desc',
    afterCursor
  } = params

  const query = fitnessFilesByActor(db, params)
    .selectAll()
    // Strictly after (createdAt, id) in the sort's own order. Only a forward
    // scan resumes from a cursor.
    .$if(Boolean(afterCursor) && orderDirection === 'asc', (qb) =>
      qb.where((eb) =>
        pastKeyset(
          eb,
          { createdAt: afterCursor!.createdAt, tieBreaker: afterCursor!.id },
          '>',
          'id'
        )
      )
    )
    .orderBy('createdAt', orderDirection)
    .orderBy('id', orderDirection)

  const rows = await withKnexPaging(db, query, { limit, offset }).execute()
  return rows.map(toFitnessFile)
}

export const countFitnessFilesByActor = async (
  db: Db,
  params: CountFitnessFilesByActorParams
): Promise<number> => {
  const row = await fitnessFilesByActor(db, params)
    .select((eb) => eb.fn.countAll().as('count'))
    .executeTakeFirst()

  // An aggregate has no declared type on SQLite, so it is converted here.
  return Number(row?.count ?? 0)
}

export const getRetriableFitnessImportBatchIds = async (
  db: Db,
  { actorId, stuckBefore }: { actorId: string; stuckBefore: Date }
): Promise<string[]> => {
  const stuckBeforeTime = timestampValue(stuckBefore)
  const rows = await db
    .selectFrom('fitness_files')
    .select('importBatchId')
    .distinct()
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .where('importBatchId', 'is not', null)
    .where((eb) =>
      eb.or([
        eb('importStatus', '=', 'failed'),
        eb('processingStatus', '=', 'failed'),
        eb.and([
          eb('processingStatus', '=', 'processing'),
          eb('updatedAt', '<=', stuckBeforeTime)
        ]),
        // A SIGABRT/OOM crashes the importer before its catch can write
        // 'failed', stranding the file at importStatus='pending' with no
        // statusId (see isFitnessImportStuck). Those orphans are retriable too.
        eb.and([
          eb('importStatus', '=', 'pending'),
          eb('statusId', 'is', null),
          eb('updatedAt', '<=', stuckBeforeTime)
        ])
      ])
    )
    .execute()

  return rows
    .map((row) => row.importBatchId)
    .filter((batchId): batchId is string => Boolean(batchId))
}

export const getFitnessFilesWithStatusForAccount = async (
  db: Db,
  {
    accountId,
    limit = 100,
    page = 1,
    maxCreatedAt
  }: GetFitnessFilesForAccountParams
): Promise<PaginatedFitnessFiles> => {
  // The total comes from the account's counter, not a count of the rows.
  const query = db
    .selectFrom('fitness_files')
    .innerJoin('actors', 'fitness_files.actorId', 'actors.id')
    .selectAll('fitness_files')
    .where('actors.accountId', '=', accountId)
    .where('fitness_files.deletedAt', 'is', null)
    .$if(Boolean(maxCreatedAt), (qb) =>
      qb.where('fitness_files.createdAt', '<', timestampValue(maxCreatedAt!))
    )
    .orderBy('fitness_files.createdAt', 'desc')

  const [total, rows] = await Promise.all([
    getCounterValue(db, CounterKey.totalFitness(accountId)),
    withKnexPaging(db, query, {
      limit,
      offset: (page - 1) * limit
    }).execute()
  ])

  return {
    items: rows.map(toFitnessFile),
    total
  }
}

// A status's files, the primary first, then by start time and upload time.
const fitnessFilesOfStatus = (db: Db, statusId: string) =>
  db
    .selectFrom('fitness_files')
    .selectAll()
    .where('statusId', '=', statusId)
    .where('deletedAt', 'is', null)
    .orderBy('isPrimary', 'desc')
    .orderBy('activityStartTime', 'asc')
    .orderBy('createdAt', 'asc')

export const getFitnessFileByStatus = async (
  db: Db,
  { statusId }: GetFitnessFileByStatusParams
): Promise<FitnessFile | null> => {
  const row = await fitnessFilesOfStatus(db, statusId)
    .limit(1)
    .executeTakeFirst()

  return row ? toFitnessFile(row) : null
}

export const getFitnessFilesByStatus = async (
  db: Db,
  { statusId }: GetFitnessFileByStatusParams
): Promise<FitnessFile[]> => {
  const rows = await fitnessFilesOfStatus(db, statusId).execute()
  return rows.map(toFitnessFile)
}

export const getFitnessFilesByBatchId = async (
  db: Db,
  { batchId }: GetFitnessFilesByBatchIdParams
): Promise<FitnessFile[]> => {
  const rows = await db
    .selectFrom('fitness_files')
    .selectAll()
    .where('importBatchId', '=', batchId)
    .where('deletedAt', 'is', null)
    .orderBy('createdAt', 'asc')
    .execute()

  return rows.map(toFitnessFile)
}

export const getFitnessStorageUsageForAccount = (
  db: Db,
  { accountId }: GetFitnessStorageUsageForAccountParams
): Promise<number> => getCounterValue(db, CounterKey.fitnessUsage(accountId))

// The facade getSQLDatabase binds with bindDb(): the reads here, the overview
// reads in ./overview.ts and the writes in ./writes.ts.
export const fitnessFileQueries = {
  getFitnessFile,
  getFitnessFilesByIds,
  getFitnessFilesByActor,
  countFitnessFilesByActor,
  getRetriableFitnessImportBatchIds,
  getFitnessFilesWithStatusForAccount,
  getFitnessFileByStatus,
  getFitnessFilesByBatchId,
  getFitnessFilesByStatus,
  getFitnessStorageUsageForAccount,
  ...fitnessFileWrites,
  ...fitnessFileOverviewQueries
}
