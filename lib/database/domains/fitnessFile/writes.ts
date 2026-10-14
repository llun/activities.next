import crypto from 'crypto'
import type { Updateable } from 'kysely'

import {
  buildProcessingStatusUpdate,
  toFitnessFile,
  truncateImportError
} from '@/lib/database/domains/fitnessFile/rows'
import type {
  CreateFitnessFileParams,
  DeleteFitnessFileParams,
  MakeFitnessFilePrimaryParams,
  MakeFitnessFilePrimaryResult,
  UpdateFitnessFileActivityData
} from '@/lib/database/domains/fitnessFile/types'
import { assignFitnessFileGearIfUnset } from '@/lib/database/domains/fitnessGear/queries'
import { type Db, inTransaction } from '@/lib/database/kysely'
import {
  decreaseCounterValue,
  increaseCounterValue
} from '@/lib/database/kysely/counter'
import { incrementBucket } from '@/lib/database/kysely/counterBucket'
import type { EpochMs, FitnessFiles } from '@/lib/database/kysely/db'
import { CounterKey } from '@/lib/database/utils/counter'
import type {
  FitnessFile,
  FitnessImportStatus,
  FitnessProcessingStatus
} from '@/lib/types/database/fitnessFile'

// The fitness file writes. Creating and deleting a file move the account's
// fitness usage and file count counters in the same transaction as the row.

// The account the actor belongs to, whose counters a file moves; null for an
// actor with no account (or no row).
const getActorAccountId = async (
  trx: Db,
  actorId: string
): Promise<string | null> => {
  const actor = await trx
    .selectFrom('actors')
    .select('accountId')
    .where('id', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  return actor?.accountId ?? null
}

export const createFitnessFile = (
  db: Db,
  params: CreateFitnessFileParams
): Promise<FitnessFile | null> =>
  inTransaction(db, async (trx) => {
    const accountId = await getActorAccountId(trx, params.actorId)

    const currentTime = new Date()
    const values = {
      id: crypto.randomUUID(),
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
      // Only ever written by the import job, once the map exists.
      mapImageEmailPath: null,
      isPrimary: true,
      importBatchId: params.importBatchId ?? null,
      importStatus: params.importBatchId ? 'pending' : null,
      importError: null,
      processingStatus: 'pending',
      totalDistanceMeters: null,
      totalDurationSeconds: null,
      movingTimeSeconds: null,
      elevationGainMeters: null,
      activityType: null,
      activityStartTime: null,
      sourceUrl: params.sourceUrl ?? null,
      // Attribution happens after parsing, from the gear whose default sports
      // claim the parsed one — never at upload time, and never from an
      // import's own record of the gear (see AGENTS.md → Fitness Gear).
      gearId: null,
      createdAt: currentTime,
      updatedAt: currentTime
    }

    await trx.insertInto('fitness_files').values(values).execute()

    if (accountId) {
      await increaseCounterValue(
        trx,
        CounterKey.fitnessUsage(accountId),
        params.bytes
      )
      await increaseCounterValue(trx, CounterKey.totalFitness(accountId), 1)
    }
    await incrementBucket(trx, 'fitness-files', 1)
    if (params.bytes > 0) {
      await incrementBucket(trx, 'fitness-bytes', params.bytes)
    }

    // The values as written, not re-read: the same answer the insert gives.
    const time = currentTime.getTime() as EpochMs
    return toFitnessFile({
      ...values,
      mapError: null,
      deviceManufacturer: null,
      deviceName: null,
      deviceGearId: null,
      avgPower: null,
      maxPower: null,
      avgHeartRate: null,
      maxHeartRate: null,
      totalWorkKj: null,
      elevationSeries: null,
      activityStartTime: null,
      createdAt: time,
      updatedAt: time,
      deletedAt: null
    })
  })

export const deleteFitnessFile = (
  db: Db,
  { id }: DeleteFitnessFileParams
): Promise<boolean> =>
  inTransaction(db, async (trx) => {
    const file = await trx
      .selectFrom('fitness_files')
      .select(['actorId', 'bytes'])
      .where('id', '=', id)
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst()

    if (!file) return false

    const accountId = await getActorAccountId(trx, file.actorId)

    const currentTime = new Date()
    await trx
      .updateTable('fitness_files')
      .set({ deletedAt: currentTime, updatedAt: currentTime })
      .where('id', '=', id)
      .execute()

    // Drop the cached route with the activity. Every aggregate over
    // `fitness_file_routes` already joins through this soft delete, so a
    // leftover row would never be counted — but it would hold the whole
    // polyline forever, and that blob is the bulk of what the cache costs.
    // Written against `trx` rather than through the facade's
    // `deleteFitnessFileRoute`, which is bound to the root instance; the delete
    // has to land or roll back with the soft delete itself. Losing it is safe
    // either way: the row is a cache of the source file, re-derived on the
    // next miss.
    await trx
      .deleteFrom('fitness_file_routes')
      .where('fitnessFileId', '=', id)
      .execute()

    if (accountId) {
      await decreaseCounterValue(
        trx,
        CounterKey.fitnessUsage(accountId),
        Number(file.bytes)
      )
      await decreaseCounterValue(trx, CounterKey.totalFitness(accountId), 1)
    }

    return true
  })

export const updateFitnessFileStatus = async (
  db: Db,
  fitnessFileId: string,
  statusId: string
): Promise<boolean> => {
  const result = await db
    .updateTable('fitness_files')
    .set({ statusId, updatedAt: new Date() })
    .where('id', '=', fitnessFileId)
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const updateFitnessFileProcessingStatus = async (
  db: Db,
  fitnessFileId: string,
  processingStatus: FitnessProcessingStatus,
  processingError?: string
): Promise<boolean> => {
  const result = await db
    .updateTable('fitness_files')
    .set(buildProcessingStatusUpdate(processingStatus, processingError))
    .where('id', '=', fitnessFileId)
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const updateFitnessFilesProcessingStatus = async (
  db: Db,
  {
    fitnessFileIds,
    processingStatus,
    processingError
  }: {
    fitnessFileIds: string[]
    processingStatus: FitnessProcessingStatus
    processingError?: string
  }
): Promise<number> => {
  if (fitnessFileIds.length === 0) {
    return 0
  }

  const result = await db
    .updateTable('fitness_files')
    .set(buildProcessingStatusUpdate(processingStatus, processingError))
    .where('id', 'in', fitnessFileIds)
    .where('deletedAt', 'is', null)
    .executeTakeFirst()

  return Number(result.numUpdatedRows)
}

export const updateFitnessFileImportStatus = async (
  db: Db,
  fitnessFileId: string,
  importStatus: FitnessImportStatus,
  importError?: string
): Promise<boolean> => {
  const result = await db
    .updateTable('fitness_files')
    .set({
      importStatus,
      importError: importError ? truncateImportError(importError) : null,
      updatedAt: new Date()
    })
    .where('id', '=', fitnessFileId)
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const updateFitnessFilesImportStatus = async (
  db: Db,
  {
    fitnessFileIds,
    importStatus,
    importError
  }: {
    fitnessFileIds: string[]
    importStatus: FitnessImportStatus
    importError?: string
  }
): Promise<number> => {
  if (fitnessFileIds.length === 0) {
    return 0
  }

  const result = await db
    .updateTable('fitness_files')
    .set({
      importStatus,
      importError: importError ? truncateImportError(importError) : null,
      updatedAt: new Date()
    })
    .where('id', 'in', fitnessFileIds)
    .where('deletedAt', 'is', null)
    .executeTakeFirst()

  return Number(result.numUpdatedRows)
}

export const updateFitnessFilePrimary = async (
  db: Db,
  fitnessFileId: string,
  isPrimary: boolean
): Promise<boolean> => {
  const result = await db
    .updateTable('fitness_files')
    .set({ isPrimary, updatedAt: new Date() })
    .where('id', '=', fitnessFileId)
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const assignFitnessFilesToImportedStatus = async (
  db: Db,
  {
    fitnessFileIds,
    primaryFitnessFileId,
    statusId
  }: {
    fitnessFileIds: string[]
    primaryFitnessFileId: string
    statusId: string
  }
): Promise<number> => {
  if (fitnessFileIds.length === 0) {
    return 0
  }
  // An undefined primary id is refused: bound as NULL in the CASE below it
  // would match no file, so every listed file would be
  // written as a completed secondary with no primary left.
  if (primaryFitnessFileId === undefined) {
    throw new Error(
      'assignFitnessFilesToImportedStatus needs a primaryFitnessFileId'
    )
  }

  const result = await db
    .updateTable('fitness_files')
    .set((eb) => ({
      statusId,
      importStatus: 'completed',
      importError: null,
      isPrimary: eb
        .case()
        .when('id', '=', primaryFitnessFileId)
        .then(eb.lit(true))
        .else(eb.lit(false))
        .end(),
      processingStatus: eb
        .case()
        .when('id', '=', primaryFitnessFileId)
        .then('pending')
        .else('completed')
        .end(),
      updatedAt: new Date()
    }))
    .where('id', 'in', fitnessFileIds)
    .where('deletedAt', 'is', null)
    .executeTakeFirst()

  return Number(result.numUpdatedRows)
}

/**
 * Moves a status's primary flag to another of its recordings.
 *
 * Everything that has to agree with the flag moves in the one transaction, so a
 * reader never sees two primaries, none, or a primary that has lost its gear or
 * its map:
 *
 * - The flag itself: every other file of the status is demoted, the target is
 *   promoted.
 * - Gear the target does not have yet, copied from the file it replaces with
 *   `assignFitnessFileGearIfUnset` (the guarded write the importer uses when it
 *   promotes a richer file), so a manual attribution on the target wins and the
 *   activity does not silently drop off its bike.
 * - The generated route map's pointers (`hasMapData`, `mapImagePath`,
 *   `mapImageEmailPath`). The processing job replaces only the map the file it
 *   is given points at, so the pointer has to follow the flag: a failed render
 *   then preserves the old map, and a successful one removes it. This mirrors
 *   the `promoteTarget` block of `importFitnessFiles`.
 *
 * It does not touch `processingStatus`. A finished recording is already
 * `completed`, and the processing job marks the file `processing` itself the
 * moment it starts, so writing `pending` here would only take a good activity
 * out of the stats rollups for as long as the message waits in the queue (and
 * strand it there if the publish failed).
 *
 * Re-running the processing job is up to the caller, after this commits.
 */
export const makeFitnessFilePrimary = (
  db: Db,
  { fitnessFileId, actorId }: MakeFitnessFilePrimaryParams
): Promise<MakeFitnessFilePrimaryResult> =>
  inTransaction(db, async (trx): Promise<MakeFitnessFilePrimaryResult> => {
    const target = await trx
      .selectFrom('fitness_files')
      .selectAll()
      .where('id', '=', fitnessFileId)
      .where('actorId', '=', actorId)
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst()
    // A file with no status is a lone upload: there is no post for it to be the
    // primary recording of.
    if (!target || !target.statusId) return { result: 'not_found' }

    // A recording that did not import cleanly is not something a post can be
    // rebuilt from. `importStatus` is null for a plain upload, which has no
    // batch to fail.
    if (
      target.processingStatus !== 'completed' ||
      target.importStatus === 'failed'
    ) {
      return { result: 'unusable' }
    }

    if (target.isPrimary === null || Boolean(target.isPrimary)) {
      return { result: 'already_primary', fitnessFile: toFitnessFile(target) }
    }

    const previous = await trx
      .selectFrom('fitness_files')
      .selectAll()
      .where('statusId', '=', target.statusId)
      .where('actorId', '=', actorId)
      .where('deletedAt', 'is', null)
      .where('id', '<>', target.id)
      .where('isPrimary', '=', true)
      .orderBy('createdAt', 'asc')
      .limit(1)
      .executeTakeFirst()

    // A primary that is still being processed owns a route map that is about to
    // be attached (or replaced). Moving the pointer under it would have its job
    // write the map for the wrong file. `failed` is fine, and is the case a
    // swap is most useful for.
    if (
      previous &&
      (previous.processingStatus === 'pending' ||
        previous.processingStatus === 'processing')
    ) {
      return { result: 'unusable' }
    }

    const now = new Date()
    await trx
      .updateTable('fitness_files')
      .set({ isPrimary: false, updatedAt: now })
      .where('statusId', '=', target.statusId)
      .where('actorId', '=', actorId)
      .where('deletedAt', 'is', null)
      .where('id', '<>', target.id)
      .execute()
    await trx
      .updateTable('fitness_files')
      .set({ isPrimary: true, updatedAt: now })
      .where('id', '=', target.id)
      .execute()

    if (previous?.gearId && !target.gearId) {
      await assignFitnessFileGearIfUnset(trx, {
        fitnessFileId: target.id,
        actorId,
        gearId: previous.gearId
      })
    }

    if (previous && (previous.mapImagePath || previous.mapImageEmailPath)) {
      await trx
        .updateTable('fitness_files')
        .set({
          hasMapData: previous.hasMapData ?? false,
          mapImagePath: previous.mapImagePath,
          mapImageEmailPath: previous.mapImageEmailPath,
          updatedAt: now
        })
        .where('id', '=', target.id)
        .execute()
      await trx
        .updateTable('fitness_files')
        .set({
          hasMapData: false,
          mapImagePath: null,
          mapImageEmailPath: null,
          // A reason recorded against a map this file no longer owns would
          // keep reading as a map failure on a secondary.
          mapError: null,
          updatedAt: now
        })
        .where('id', '=', previous.id)
        .execute()
    }

    const updated = await trx
      .selectFrom('fitness_files')
      .selectAll()
      .where('id', '=', target.id)
      .limit(1)
      .executeTakeFirstOrThrow()

    return {
      result: 'promoted',
      fitnessFile: toFitnessFile(updated),
      previousPrimaryId: previous?.id ?? null
    }
  })

const NUMBER_FIELDS = [
  'totalDistanceMeters',
  'totalDurationSeconds',
  'movingTimeSeconds',
  'elevationGainMeters',
  'avgPower',
  'maxPower',
  'avgHeartRate',
  'maxHeartRate',
  'totalWorkKj'
] as const satisfies ReadonlyArray<keyof UpdateFitnessFileActivityData>

export const updateFitnessFileActivityData = async (
  db: Db,
  fitnessFileId: string,
  data: UpdateFitnessFileActivityData
): Promise<boolean> => {
  // Presence semantics: a key that is absent leaves its column alone, a key
  // set to null (or undefined) clears it.
  const updateData: Updateable<FitnessFiles> = {
    updatedAt: new Date()
  }

  for (const field of NUMBER_FIELDS) {
    if (!(field in data)) continue
    const value = data[field]
    updateData[field] = typeof value === 'number' ? value : null
  }
  if ('elevationSeries' in data) {
    if (Array.isArray(data.elevationSeries)) {
      updateData.elevationSeries = JSON.stringify(data.elevationSeries)
    } else {
      updateData.elevationSeries = data.elevationSeries ?? null
    }
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
  if ('mapImageEmailPath' in data) {
    updateData.mapImageEmailPath = data.mapImageEmailPath ?? null
  }
  if ('mapError' in data) {
    // Shares `importError`'s cap: both are operator/owner-facing reasons
    // written from a thrown value, so an unbounded message is the same insert
    // hazard here as there.
    updateData.mapError = data.mapError
      ? truncateImportError(data.mapError)
      : null
  }
  if ('deviceManufacturer' in data) {
    updateData.deviceManufacturer = data.deviceManufacturer ?? null
  }
  if ('deviceName' in data) {
    updateData.deviceName = data.deviceName ?? null
  }
  if ('sourceUrl' in data) {
    updateData.sourceUrl = data.sourceUrl ?? null
  }
  if ('deviceGearId' in data) {
    updateData.deviceGearId = data.deviceGearId ?? null
  }

  const result = await db
    .updateTable('fitness_files')
    .set(updateData)
    .where('id', '=', fitnessFileId)
    .executeTakeFirst()

  return Number(result.numUpdatedRows) > 0
}

export const fitnessFileWrites = {
  createFitnessFile,
  deleteFitnessFile,
  updateFitnessFileStatus,
  updateFitnessFileProcessingStatus,
  updateFitnessFilesProcessingStatus,
  updateFitnessFileImportStatus,
  updateFitnessFilesImportStatus,
  updateFitnessFilePrimary,
  assignFitnessFilesToImportedStatus,
  makeFitnessFilePrimary,
  updateFitnessFileActivityData
}
