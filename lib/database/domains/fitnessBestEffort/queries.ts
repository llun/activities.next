import type {
  FitnessBestEffortKind,
  FitnessPersonalRecord,
  GetFitnessBestEffortsParams,
  GetFitnessPersonalRecordsParams,
  ReplaceFitnessBestEffortsParams,
  StoredFitnessBestEffort
} from '@/lib/database/domains/fitnessBestEffort/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { countableActivity } from '@/lib/database/kysely/countableActivity'
import { forShare, timestampValue } from '@/lib/database/kysely/dialect'
import {
  BEST_EFFORT_DURATIONS,
  RUN_EFFORT_DISTANCES
} from '@/lib/fitness/bestEfforts'

/**
 * Rewrites one file's efforts: the previous run's rows go and these take
 * their place, in one transaction, so reprocessing a file never leaves a mix.
 * Refuses a deleted file the way the route-data cache does: `deleteFitnessFile`
 * soft-deletes and removes these rows in its own transaction, and the share
 * lock keeps a write racing it from bringing them back.
 */
export const replaceFitnessBestEfforts = (
  db: Db,
  {
    fitnessFileId,
    actorId,
    statusId,
    activityType,
    activityDate,
    efforts
  }: ReplaceFitnessBestEffortsParams
): Promise<void> =>
  inTransaction(db, async (trx) => {
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
        `Cannot store best efforts for missing or deleted fitness file: ${fitnessFileId}`
      )
    }

    await trx
      .deleteFrom('fitness_best_efforts')
      .where('fitnessFileId', '=', fitnessFileId)
      .execute()
    if (efforts.length === 0) return

    const createdAt = new Date()
    await trx
      .insertInto('fitness_best_efforts')
      .values(
        efforts.map((effort) => ({
          fitnessFileId,
          actorId,
          statusId,
          activityType,
          kind: effort.kind,
          key: effort.key,
          value: effort.value,
          activityDate: new Date(activityDate),
          createdAt
        }))
      )
      .execute()
  })

export const getFitnessBestEfforts = async (
  db: Db,
  { fitnessFileIds }: GetFitnessBestEffortsParams
): Promise<StoredFitnessBestEffort[]> => {
  if (fitnessFileIds.length === 0) return []
  const rows = await db
    .selectFrom('fitness_best_efforts')
    .select(['fitnessFileId', 'kind', 'key', 'value'])
    .where('fitnessFileId', 'in', fitnessFileIds)
    .orderBy('fitnessFileId')
    .orderBy('kind')
    .orderBy('key')
    .execute()
  return rows.map((row) => ({
    fitnessFileId: row.fitnessFileId,
    kind: row.kind as FitnessBestEffortKind,
    key: Number(row.key),
    value: Number(row.value)
  }))
}

const RECORD_KEYS: Array<{ kind: FitnessBestEffortKind; key: number }> = [
  ...BEST_EFFORT_DURATIONS.map((key) => ({ kind: 'power' as const, key })),
  ...RUN_EFFORT_DISTANCES.map((key) => ({ kind: 'distance' as const, key }))
]

/**
 * The actor's best stored effort for every (kind, key) that has one: the
 * highest power, the shortest time. Only countable activities (primary,
 * completed, not deleted, the rule every fitness rollup uses) on a post that
 * still exists and is the actor's own, read through the file's current
 * `statusId`. A tie goes to the earlier activity, the one that set it. One
 * small indexed read per key, on the (actorId, kind, key, activityDate) index.
 */
export const getFitnessPersonalRecords = async (
  db: Db,
  { actorId, since }: GetFitnessPersonalRecordsParams
): Promise<FitnessPersonalRecord[]> => {
  const rows = await Promise.all(
    RECORD_KEYS.map(({ kind, key }) =>
      db
        .selectFrom('fitness_best_efforts')
        .innerJoin(
          'fitness_files',
          'fitness_files.id',
          'fitness_best_efforts.fitnessFileId'
        )
        .innerJoin('statuses', 'statuses.id', 'fitness_files.statusId')
        .select([
          'fitness_best_efforts.fitnessFileId',
          'fitness_best_efforts.kind',
          'fitness_best_efforts.key',
          'fitness_best_efforts.value',
          'fitness_best_efforts.activityDate',
          'fitness_best_efforts.activityType',
          'fitness_files.statusId',
          'fitness_files.description',
          'fitness_files.fileName'
        ])
        .where('fitness_best_efforts.actorId', '=', actorId)
        .where('fitness_best_efforts.kind', '=', kind)
        .where('fitness_best_efforts.key', '=', key)
        .$if(typeof since === 'number', (qb) =>
          qb.where(
            'fitness_best_efforts.activityDate',
            '>=',
            timestampValue(since as number)
          )
        )
        .where('fitness_files.actorId', '=', actorId)
        .where('statuses.actorId', '=', actorId)
        .where((eb) => countableActivity(eb))
        .orderBy(
          'fitness_best_efforts.value',
          kind === 'power' ? 'desc' : 'asc'
        )
        .orderBy('fitness_best_efforts.activityDate', 'asc')
        .orderBy('fitness_best_efforts.fitnessFileId', 'asc')
        .limit(1)
        .executeTakeFirst()
    )
  )

  return rows.flatMap((row) =>
    row && row.statusId
      ? [
          {
            fitnessFileId: row.fitnessFileId,
            kind: row.kind as FitnessBestEffortKind,
            key: Number(row.key),
            value: Number(row.value),
            statusId: row.statusId,
            activityDate: Number(row.activityDate),
            activityType: row.activityType ?? null,
            description: row.description ?? null,
            fileName: String(row.fileName)
          }
        ]
      : []
  )
}

export const fitnessBestEffortQueries = {
  replaceFitnessBestEfforts,
  getFitnessBestEfforts,
  getFitnessPersonalRecords
}
