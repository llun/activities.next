import crypto from 'crypto'
import { Knex } from 'knex'

import { applyCountableActivityFilter } from '@/lib/database/sql/utils/countableActivity'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/sql/utils/knex'
import { FitnessGearKind } from '@/lib/services/fitness-files/sportTypes'
import {
  FitnessGear,
  FitnessGearComponent,
  FitnessGearDeviceRollup,
  FitnessGearDistanceRollup,
  SQLFitnessGear,
  SQLFitnessGearComponent
} from '@/lib/types/database/fitnessGear'

/**
 * One row of a gear's activity list — the identity of the activity and of the
 * post it was published as, and nothing else.
 *
 * Deliberately this narrow because a gear's page renders the POST, not the row:
 * the route hands `statusId` to `getStatusesByIds` and pages on the row count.
 * Everything the old compact list needed (`fileName`, `description`,
 * `activityType`, the distance, and the `statuses` join behind `publicId`) came
 * off the query with it, since each of those was paid on every page of a
 * history that can run to five figures.
 *
 * `statusId` is null for an activity that was never posted, or whose post has
 * since been deleted — deleting a status only nulls the column, leaving a row
 * that still counts toward the gear's totals with no post left to render.
 */
export interface FitnessGearActivity {
  id: string
  statusId: string | null
}

export interface CreateFitnessGearParams {
  actorId: string
  kind: FitnessGearKind
  name: string
  brand?: string | null
  model?: string | null
  bikeType?: string | null
  weightKilograms?: number | null
  defaultSports?: string[]
  alertDistanceMeters?: number | null
  notes?: string | null
  // Create-only, like `kind`: `deviceKey` is the identity every later upload
  // matches against, so rewriting it would fork the device's own history.
  deviceKey?: string | null
  // Every kind may carry one. A device's is seeded here from the brand map by
  // `resolveDeviceGear`; a bike's or a pair of shoes' comes from the gear form.
  productUrl?: string | null
}

// Every optional field uses presence semantics (`'field' in params`): absent
// leaves the column alone, an explicit null clears it.
export interface UpdateFitnessGearParams {
  id: string
  actorId: string
  name?: string
  brand?: string | null
  model?: string | null
  bikeType?: string | null
  weightKilograms?: number | null
  defaultSports?: string[]
  alertDistanceMeters?: number | null
  notes?: string | null
  productUrl?: string | null
}

export interface CreateFitnessGearComponentParams {
  gearId: string
  actorId: string
  componentType: string
  brand?: string | null
  model?: string | null
  addedAt?: Date | null
  removedAt?: Date | null
  serviceDistanceMeters?: number | null
}

export interface UpdateFitnessGearComponentParams {
  id: string
  gearId: string
  actorId: string
  componentType?: string
  brand?: string | null
  model?: string | null
  addedAt?: Date | null
  removedAt?: Date | null
  serviceDistanceMeters?: number | null
}

export interface FitnessGearDatabase {
  createFitnessGear(params: CreateFitnessGearParams): Promise<FitnessGear>
  getFitnessGear(params: {
    id: string
    actorId: string
  }): Promise<FitnessGear | null>
  getFitnessGearsByActor(params: { actorId: string }): Promise<FitnessGear[]>
  getFitnessGearNamesByIds(params: {
    ids: string[]
  }): Promise<Record<string, string>>
  updateFitnessGear(
    params: UpdateFitnessGearParams
  ): Promise<FitnessGear | null>
  setFitnessGearRetired(params: {
    id: string
    actorId: string
    retired: boolean
  }): Promise<FitnessGear | null>
  deleteFitnessGear(params: { id: string; actorId: string }): Promise<boolean>
  getFitnessGearDistanceRollups(params: {
    actorId: string
    gearIds: string[]
  }): Promise<Record<string, FitnessGearDistanceRollup>>
  getFitnessGearDeviceRollups(params: {
    actorId: string
    gearIds: string[]
  }): Promise<Record<string, FitnessGearDeviceRollup>>
  getFitnessGearActivities(params: {
    actorId: string
    gearId: string
    kind: FitnessGearKind
    limit: number
    offset?: number
  }): Promise<FitnessGearActivity[]>
  findFitnessGearByDeviceKey(params: {
    actorId: string
    deviceKey: string
  }): Promise<FitnessGear | null>
  findFitnessGearByDefaultSport(params: {
    actorId: string
    sportKey: string
  }): Promise<FitnessGear | null>
  findFitnessGearByName(params: {
    actorId: string
    name: string
  }): Promise<FitnessGear | null>
  setFitnessGearLastAlertedDistance(params: {
    id: string
    lastAlertedDistanceMeters: number | null
    // When set, the write only lands if no alert has been recorded at or above
    // this threshold — so the database, not a prior read, decides which of two
    // concurrent evaluations owns the crossing. Returns false when it loses.
    onlyIfBelowThresholdMeters?: number
  }): Promise<boolean>

  createFitnessGearComponent(
    params: CreateFitnessGearComponentParams
  ): Promise<FitnessGearComponent | null>
  getFitnessGearComponents(params: {
    gearId: string
    actorId: string
  }): Promise<FitnessGearComponent[]>
  updateFitnessGearComponent(
    params: UpdateFitnessGearComponentParams
  ): Promise<FitnessGearComponent | null>
  deleteFitnessGearComponent(params: {
    id: string
    gearId: string
    actorId: string
  }): Promise<boolean>
  replaceFitnessGearComponent(params: {
    id: string
    gearId: string
    actorId: string
    brand?: string | null
    model?: string | null
  }): Promise<{
    retired: FitnessGearComponent
    replacement: FitnessGearComponent
  } | null>
  getFitnessGearComponentDistanceRollups(params: {
    actorId: string
    gearIds: string[]
  }): Promise<Record<string, FitnessGearDistanceRollup>>
  setFitnessGearComponentLastAlertedDistance(params: {
    id: string
    lastAlertedDistanceMeters: number | null
    // When set, the write only lands if no alert has been recorded at or above
    // this threshold — so the database, not a prior read, decides which of two
    // concurrent evaluations owns the crossing. Returns false when it loses.
    onlyIfBelowThresholdMeters?: number
  }): Promise<boolean>

  setFitnessFileGear(params: {
    fitnessFileId: string
    actorId: string
    gearId: string | null
  }): Promise<{ id: string; gearId: string | null } | null>
  assignFitnessFileGearIfUnset(params: {
    fitnessFileId: string
    actorId: string
    gearId: string
  }): Promise<boolean>
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

/**
 * `defaultSports` is written by this module as a JSON array of canonical sport
 * keys. A value that does not parse back to an array of strings is treated as
 * "no defaults" rather than throwing: the column only ever gates auto-assign,
 * so a corrupt value must not make the gear unreadable.
 */
const parseDefaultSports = (value?: string | null): string[] => {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

const parseSQLFitnessGear = (row: SQLFitnessGear): FitnessGear => ({
  id: row.id,
  actorId: row.actorId,
  kind: row.kind,
  name: row.name,
  brand: row.brand ?? undefined,
  model: row.model ?? undefined,
  bikeType: row.bikeType ?? undefined,
  weightKilograms: normalizeOptionalNumber(row.weightKilograms),
  defaultSports: parseDefaultSports(row.defaultSports),
  alertDistanceMeters: normalizeOptionalNumber(row.alertDistanceMeters),
  lastAlertedDistanceMeters: normalizeOptionalNumber(
    row.lastAlertedDistanceMeters
  ),
  notes: row.notes ?? undefined,
  deviceKey: row.deviceKey ?? undefined,
  productUrl: row.productUrl ?? undefined,
  retiredAt: row.retiredAt ? getCompatibleTime(row.retiredAt) : undefined,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

const parseSQLFitnessGearComponent = (
  row: SQLFitnessGearComponent
): FitnessGearComponent => ({
  id: row.id,
  gearId: row.gearId,
  componentType: row.componentType,
  brand: row.brand ?? undefined,
  model: row.model ?? undefined,
  addedAt: row.addedAt ? getCompatibleTime(row.addedAt) : undefined,
  removedAt: row.removedAt ? getCompatibleTime(row.removedAt) : undefined,
  serviceDistanceMeters: normalizeOptionalNumber(row.serviceDistanceMeters),
  lastAlertedDistanceMeters: normalizeOptionalNumber(
    row.lastAlertedDistanceMeters
  ),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

/**
 * A sport can be the default of at most one of an actor's gears. Picking it for
 * a new gear therefore takes it away from whichever gear held it.
 *
 * The invariant covers every non-deleted gear, retired ones included: scoping
 * it to active gear would let unretiring produce two holders of the same sport,
 * and then auto-assign would have to pick arbitrarily between them.
 */
const stealDefaultSports = async (
  trx: Knex.Transaction,
  actorId: string,
  sportKeys: string[],
  exceptGearId?: string
) => {
  if (sportKeys.length === 0) return

  const claimed = new Set(sportKeys)
  const query = trx<SQLFitnessGear>('fitness_gears')
    .where('actorId', actorId)
    .whereNull('deletedAt')
    .whereNotNull('defaultSports')
    .select('id', 'defaultSports')
  if (exceptGearId) {
    query.whereNot('id', exceptGearId)
  }

  const rows = await query
  const currentTime = new Date()
  for (const row of rows) {
    const existing = parseDefaultSports(row.defaultSports)
    const remaining = existing.filter((key) => !claimed.has(key))
    if (remaining.length === existing.length) continue

    await trx('fitness_gears')
      .where('id', row.id)
      .update({
        defaultSports: JSON.stringify(remaining),
        updatedAt: currentTime
      })
  }
}

const getOwnedGearRow = async (
  connection: Knex | Knex.Transaction,
  id: string,
  actorId: string
) =>
  connection<SQLFitnessGear>('fitness_gears')
    .where('id', id)
    .where('actorId', actorId)
    .whereNull('deletedAt')
    .first()

const getOwnedComponentRow = async (
  connection: Knex | Knex.Transaction,
  { id, gearId, actorId }: { id: string; gearId: string; actorId: string }
) =>
  connection<SQLFitnessGearComponent>('fitness_gear_components as c')
    .innerJoin('fitness_gears as g', 'g.id', 'c.gearId')
    .where('c.id', id)
    .where('c.gearId', gearId)
    .where('g.actorId', actorId)
    .whereNull('c.deletedAt')
    .whereNull('g.deletedAt')
    .select('c.*')
    .first()

export const FitnessGearSQLDatabaseMixin = (
  database: Knex
): FitnessGearDatabase => ({
  async createFitnessGear(params: CreateFitnessGearParams) {
    return database.transaction(async (trx) => {
      const currentTime = new Date()
      const defaultSports = params.defaultSports ?? []

      await stealDefaultSports(trx, params.actorId, defaultSports)

      const data: SQLFitnessGear = {
        id: crypto.randomUUID(),
        actorId: params.actorId,
        kind: params.kind,
        name: params.name,
        brand: params.brand ?? null,
        model: params.model ?? null,
        bikeType: params.bikeType ?? null,
        weightKilograms: params.weightKilograms ?? null,
        defaultSports: JSON.stringify(defaultSports),
        alertDistanceMeters: params.alertDistanceMeters ?? null,
        lastAlertedDistanceMeters: null,
        notes: params.notes ?? null,
        deviceKey: params.deviceKey ?? null,
        productUrl: params.productUrl ?? null,
        retiredAt: null,
        createdAt: currentTime,
        updatedAt: currentTime,
        deletedAt: null
      }

      await trx('fitness_gears').insert(data)

      return parseSQLFitnessGear(data)
    })
  },

  async getFitnessGear({ id, actorId }) {
    const row = await getOwnedGearRow(database, id, actorId)
    return row ? parseSQLFitnessGear(row) : null
  },

  async getFitnessGearsByActor({ actorId }) {
    const rows = await database<SQLFitnessGear>('fitness_gears')
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')

    return rows.map(parseSQLFitnessGear)
  },

  async getFitnessGearNamesByIds({ ids }) {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) return {}

    const names: Record<string, string> = {}
    for (const chunk of chunkArray(uniqueIds, getWhereInBatchSize(database))) {
      const rows = await database<SQLFitnessGear>('fitness_gears')
        .whereIn('id', chunk)
        .whereNull('deletedAt')
        .select('id', 'name')
      for (const row of rows) {
        names[row.id] = row.name
      }
    }

    return names
  },

  async updateFitnessGear(params: UpdateFitnessGearParams) {
    return database.transaction(async (trx) => {
      const existing = await getOwnedGearRow(trx, params.id, params.actorId)
      if (!existing) return null

      const updateData: Record<string, unknown> = { updatedAt: new Date() }

      if ('name' in params && params.name !== undefined) {
        updateData.name = params.name
      }
      if ('brand' in params) updateData.brand = params.brand ?? null
      if ('model' in params) updateData.model = params.model ?? null
      if ('bikeType' in params) updateData.bikeType = params.bikeType ?? null
      if ('weightKilograms' in params) {
        updateData.weightKilograms = params.weightKilograms ?? null
      }
      if ('notes' in params) updateData.notes = params.notes ?? null
      // `deviceKey` is deliberately absent: it is the device's identity, not a
      // display field, and the owner edits the other four freely without
      // forking the row the next upload resolves to.
      if ('productUrl' in params) {
        updateData.productUrl = params.productUrl ?? null
      }
      if ('alertDistanceMeters' in params) {
        updateData.alertDistanceMeters = params.alertDistanceMeters ?? null
        // A changed threshold re-arms the reminder: the owner asking to be told
        // at a new distance expects to be told, even if the old one already
        // fired.
        if (
          (params.alertDistanceMeters ?? null) !==
          (normalizeOptionalNumber(existing.alertDistanceMeters) ?? null)
        ) {
          updateData.lastAlertedDistanceMeters = null
        }
      }
      if ('defaultSports' in params && params.defaultSports) {
        await stealDefaultSports(
          trx,
          params.actorId,
          params.defaultSports,
          params.id
        )
        updateData.defaultSports = JSON.stringify(params.defaultSports)
      }

      await trx('fitness_gears').where('id', params.id).update(updateData)

      const updated = await getOwnedGearRow(trx, params.id, params.actorId)
      return updated ? parseSQLFitnessGear(updated) : null
    })
  },

  async setFitnessGearRetired({ id, actorId, retired }) {
    const currentTime = new Date()

    // The state change is a predicate on the UPDATE, not a decision taken from
    // a read in front of it. Only a real transition may write — re-sending
    // `{retired: true}` for gear already retired must not move the date the
    // owner put it away on, nor clear an alert that has already fired and let
    // the next activity notify again at the same threshold.
    //
    // Expressed in the statement rather than decided from a read in front of
    // it, because a read-then-write lets two concurrent requests both see "not
    // retired yet" and both write. The app's own button disables itself while
    // the request is in flight, so the case is not a double click — it is two
    // tabs, a retried request, or any other API client.
    const query = database('fitness_gears')
      .where('id', id)
      .where('actorId', actorId)
      .whereNull('deletedAt')
    if (retired) {
      query.whereNull('retiredAt')
    } else {
      query.whereNotNull('retiredAt')
    }

    await query.update({
      retiredAt: retired ? currentTime : null,
      // Retiring freezes the total and unretiring resumes it; either way the
      // next crossing is a fresh one.
      lastAlertedDistanceMeters: null,
      updatedAt: currentTime
    })

    // Deliberately not keyed on the affected-row count: zero rows means either
    // "already in that state" (a successful no-op, which must return the gear)
    // or "no such gear of yours" (null). The re-read tells them apart, and it
    // is the same read the success path needs anyway.
    const row = await getOwnedGearRow(database, id, actorId)
    return row ? parseSQLFitnessGear(row) : null
  },

  async deleteFitnessGear({ id, actorId }) {
    return database.transaction(async (trx) => {
      const currentTime = new Date()
      const deleted = await trx('fitness_gears')
        .where('id', id)
        .where('actorId', actorId)
        .whereNull('deletedAt')
        .update({
          deletedAt: currentTime,
          updatedAt: currentTime,
          // The `(actorId, deviceKey)` unique index covers soft-deleted rows
          // too, so a deleted device would otherwise keep its key reserved and
          // the next upload from that device could never create a row — the
          // insert would fail against a row nothing can see. Releasing the key
          // here is what makes deleting a device a "start over", not a
          // permanent ban on it.
          deviceKey: null
        })
      if (deleted === 0) return false

      // Activities outlive their gear: they keep their own distance and simply
      // stop being attributed. Component rows are left in place — every read
      // joins through a non-deleted gear, so they are already unreachable.
      await trx('fitness_files')
        .where('gearId', id)
        .update({ gearId: null, updatedAt: currentTime })

      // The device link is a separate column and is detached the same way: an
      // activity keeps the `deviceName`/`deviceManufacturer` it was recorded
      // with and simply stops pointing at a row that no longer exists.
      await trx('fitness_files')
        .where('deviceGearId', id)
        .update({ deviceGearId: null, updatedAt: currentTime })

      return true
    })
  },

  async getFitnessGearDistanceRollups({ actorId, gearIds }) {
    const uniqueIds = [...new Set(gearIds)]
    const rollups: Record<string, FitnessGearDistanceRollup> = {}
    for (const gearId of uniqueIds) {
      rollups[gearId] = { distanceMeters: 0, activityCount: 0 }
    }
    if (uniqueIds.length === 0) return rollups

    for (const chunk of chunkArray(
      uniqueIds,
      getWhereInBatchSize(database, 3)
    )) {
      const rows = await applyCountableActivityFilter(
        database,
        database('fitness_files'),
        'fitness_files'
      )
        .where('fitness_files.actorId', actorId)
        .whereIn('fitness_files.gearId', chunk)
        .groupBy('fitness_files.gearId')
        .select(
          'fitness_files.gearId as gearId',
          database.raw('COUNT(*) as ??', ['activityCount']),
          database.raw('COALESCE(SUM(??), 0) as ??', [
            'fitness_files.totalDistanceMeters',
            'distanceMeters'
          ])
        )

      for (const row of rows as Record<string, unknown>[]) {
        const gearId = String(row.gearId)
        rollups[gearId] = {
          distanceMeters: Number(row.distanceMeters) || 0,
          activityCount: Number(row.activityCount) || 0
        }
      }
    }

    return rollups
  },

  async getFitnessGearDeviceRollups({ actorId, gearIds }) {
    const uniqueIds = [...new Set(gearIds)]
    const rollups: Record<string, FitnessGearDeviceRollup> = {}
    // Pre-seeded with zeros so a device with nothing linked yet still gets a
    // row, exactly like the distance rollup — the caller must never have to
    // tell "no activities" apart from "no such gear".
    for (const gearId of uniqueIds) {
      rollups[gearId] = { activityCount: 0, firstUsedAt: null }
    }
    if (uniqueIds.length === 0) return rollups

    for (const chunk of chunkArray(
      uniqueIds,
      // A larger reserve than the distance rollup's: the per-ride-per-device
      // predicate binds `'completed'` twice plus two booleans on top of
      // `actorId`, and SQLite counts every one of them toward its 999-variable
      // ceiling.
      getWhereInBatchSize(database, 8)
    )) {
      // The same countable-activity predicate the distance rollups use, with
      // `isPrimary` replaced by the per-ride-per-device rule — see the filter's
      // own comment.
      const rows = await applyCountableActivityFilter(
        database,
        database('fitness_files'),
        'fitness_files',
        { forDeviceLink: true }
      )
        .where('fitness_files.actorId', actorId)
        .whereIn('fitness_files.deviceGearId', chunk)
        .groupBy('fitness_files.deviceGearId')
        .select(
          'fitness_files.deviceGearId as deviceGearId',
          database.raw('COUNT(*) as ??', ['activityCount']),
          // Distance is deliberately not summed: a device records rides and
          // runs alike, so a combined total would be a number with no meaning.
          database.raw('MIN(??) as ??', [
            'fitness_files.activityStartTime',
            'firstUsedAt'
          ])
        )

      for (const row of rows as Record<string, unknown>[]) {
        const gearId = String(row.deviceGearId)
        rollups[gearId] = {
          activityCount: Number(row.activityCount) || 0,
          // MIN comes back as a Date on PostgreSQL and an integer on SQLite;
          // `getCompatibleTime` is the one place that difference is resolved.
          // It is null when every linked activity is timestamp-less.
          firstUsedAt:
            row.firstUsedAt === null || row.firstUsedAt === undefined
              ? null
              : getCompatibleTime(row.firstUsedAt as number | Date | string)
        }
      }
    }

    return rollups
  },

  async getFitnessGearActivities({ actorId, gearId, kind, limit, offset = 0 }) {
    // A device is linked through its own column; a bike or a pair of shoes
    // through `gearId`. One query serves both rather than two near-identical
    // ones that could drift apart on the filter they share.
    const isDevice = kind === 'device'
    const matchColumn = isDevice
      ? 'fitness_files.deviceGearId'
      : 'fitness_files.gearId'

    // No `statusId` predicate anywhere below: an activity whose post was never
    // made, or has since been deleted, still occupies a row here, and the
    // caller pages on rows. Filtering those out would make the offsets skip
    // them and re-serve the rows behind them on every page.
    const rows = await applyCountableActivityFilter(
      database,
      database('fitness_files'),
      'fitness_files',
      // Matches this kind's rollup exactly, so the only thing that can
      // separate the count from what the page shows is an activity whose post
      // was deleted — still a row here and still counted there, with no post
      // left to render.
      { forDeviceLink: isDevice }
    )
      .where('fitness_files.actorId', actorId)
      .where(matchColumn, gearId)
      //
      // Sorting the timestamp-less activities last is load-bearing rather than
      // tidy: under DESC the two backends disagree on where NULLs land
      // (PostgreSQL puts them first, SQLite last), so a GPX carrying no
      // timestamps would head the list on one backend and tail it on the other
      // — and paginate inconsistently.
      //
      // Written as a portable CASE rather than knex's `nulls: 'last'` option
      // because that option is broken on SQLite: knex emulates it as
      // `order by (col is null) desc` and DROPS the column's own direction, so
      // the list comes back nulls-first AND unsorted. `??` interpolation keeps
      // the identifier quoted per dialect.
      .orderByRaw('case when ?? is null then 1 else 0 end asc', [
        'fitness_files.activityStartTime'
      ])
      .orderBy('fitness_files.activityStartTime', 'desc')
      .orderBy('fitness_files.createdAt', 'desc')
      // A stable tiebreak: two activities imported in the same batch can share
      // both timestamps, and an unordered pair would repeat or skip a row
      // across pages.
      .orderBy('fitness_files.id', 'desc')
      .limit(limit)
      .offset(offset)
      .select('fitness_files.id as id', 'fitness_files.statusId as statusId')

    return (rows as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      statusId: (row.statusId as string | null) ?? null
    }))
  },

  async findFitnessGearByDeviceKey({ actorId, deviceKey }) {
    // Soft-deleted rows are excluded here and their key is released on delete,
    // so a device someone removed is recreated from scratch on its next upload
    // rather than resurrecting with the notes and name they threw away.
    const row = await database<SQLFitnessGear>('fitness_gears')
      .where('actorId', actorId)
      .where('deviceKey', deviceKey)
      .whereNull('deletedAt')
      .first()

    return row ? parseSQLFitnessGear(row) : null
  },

  async findFitnessGearByDefaultSport({ actorId, sportKey }) {
    // Active gear only — retired gear is out of auto-assign by definition.
    // The per-actor gear count is tiny and `defaultSports` is a JSON string, so
    // matching in JS beats a backend-specific JSON operator.
    const rows = await database<SQLFitnessGear>('fitness_gears')
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .whereNull('retiredAt')
      .whereNotNull('defaultSports')
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')

    const match = rows.find((row) =>
      parseDefaultSports(row.defaultSports).includes(sportKey)
    )
    return match ? parseSQLFitnessGear(match) : null
  },

  async findFitnessGearByName({ actorId, name }) {
    const trimmed = name.trim()
    if (!trimmed) return null

    // Case-insensitive without relying on a backend collation: the gear
    // import script keys on the name in its plan file, and per-actor gear
    // counts are small enough to compare in JS.
    const normalized = trimmed.toLowerCase()
    const rows = await database<SQLFitnessGear>('fitness_gears')
      .where('actorId', actorId)
      .whereNull('deletedAt')
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')

    const match = rows.find(
      (row) => row.name.trim().toLowerCase() === normalized
    )
    return match ? parseSQLFitnessGear(match) : null
  },

  async setFitnessGearLastAlertedDistance({
    id,
    lastAlertedDistanceMeters,
    onlyIfBelowThresholdMeters
  }) {
    // With `onlyIfBelowThresholdMeters` the UPDATE itself decides whether this
    // caller won the crossing, so two evaluations racing on the same gear (two
    // queued imports, a same-ride two-device upload) produce one notification
    // instead of two. Without it, both would read the same stale null.
    const query = database('fitness_gears')
      .where('id', id)
      .whereNull('deletedAt')
    if (onlyIfBelowThresholdMeters !== undefined) {
      query.where((builder) =>
        builder
          .whereNull('lastAlertedDistanceMeters')
          .orWhere('lastAlertedDistanceMeters', '<', onlyIfBelowThresholdMeters)
      )
    }

    const updated = await query.update({
      lastAlertedDistanceMeters,
      updatedAt: new Date()
    })
    return updated > 0
  },

  async createFitnessGearComponent(params: CreateFitnessGearComponentParams) {
    const gear = await getOwnedGearRow(database, params.gearId, params.actorId)
    if (!gear) return null

    const currentTime = new Date()
    const data: SQLFitnessGearComponent = {
      id: crypto.randomUUID(),
      gearId: params.gearId,
      componentType: params.componentType,
      brand: params.brand ?? null,
      model: params.model ?? null,
      addedAt: params.addedAt ?? null,
      removedAt: params.removedAt ?? null,
      serviceDistanceMeters: params.serviceDistanceMeters ?? null,
      lastAlertedDistanceMeters: null,
      createdAt: currentTime,
      updatedAt: currentTime,
      deletedAt: null
    }

    await database('fitness_gear_components').insert(data)
    return parseSQLFitnessGearComponent(data)
  },

  async getFitnessGearComponents({ gearId, actorId }) {
    const rows = await database<SQLFitnessGearComponent>(
      'fitness_gear_components as c'
    )
      .innerJoin('fitness_gears as g', 'g.id', 'c.gearId')
      .where('c.gearId', gearId)
      .where('g.actorId', actorId)
      .whereNull('c.deletedAt')
      .whereNull('g.deletedAt')
      .select('c.*')
      // Only gives the installed group a stable oldest-first order; where the
      // removed ones land is decided below.
      .orderBy('c.createdAt', 'asc')

    // Installed parts first, then the replaced ones newest-first. Split here
    // rather than with an `ORDER BY removedAt` because the backends disagree on
    // whether NULLs sort first or last, and "still fitted" has to come first.
    const parsed = rows.map(parseSQLFitnessGearComponent)
    const installed = parsed.filter((component) => !component.removedAt)
    const replaced = parsed
      .filter((component) => component.removedAt)
      // Both are non-null: the array was just filtered on `removedAt`.
      .sort(
        (first, second) =>
          (second.removedAt as number) - (first.removedAt as number)
      )
    return [...installed, ...replaced]
  },

  async updateFitnessGearComponent(params: UpdateFitnessGearComponentParams) {
    const existing = await getOwnedComponentRow(database, {
      id: params.id,
      gearId: params.gearId,
      actorId: params.actorId
    })
    if (!existing) return null

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if ('componentType' in params && params.componentType !== undefined) {
      updateData.componentType = params.componentType
    }
    if ('brand' in params) updateData.brand = params.brand ?? null
    if ('model' in params) updateData.model = params.model ?? null
    if ('addedAt' in params) updateData.addedAt = params.addedAt ?? null
    if ('removedAt' in params) updateData.removedAt = params.removedAt ?? null
    if ('serviceDistanceMeters' in params) {
      updateData.serviceDistanceMeters = params.serviceDistanceMeters ?? null
      if (
        (params.serviceDistanceMeters ?? null) !==
        (normalizeOptionalNumber(existing.serviceDistanceMeters) ?? null)
      ) {
        updateData.lastAlertedDistanceMeters = null
      }
    }

    await database('fitness_gear_components')
      .where('id', params.id)
      .update(updateData)

    const updated = await getOwnedComponentRow(database, {
      id: params.id,
      gearId: params.gearId,
      actorId: params.actorId
    })
    return updated ? parseSQLFitnessGearComponent(updated) : null
  },

  async deleteFitnessGearComponent({ id, gearId, actorId }) {
    const existing = await getOwnedComponentRow(database, {
      id,
      gearId,
      actorId
    })
    if (!existing) return false

    const currentTime = new Date()
    const deleted = await database('fitness_gear_components')
      .where('id', id)
      .whereNull('deletedAt')
      .update({ deletedAt: currentTime, updatedAt: currentTime })
    return deleted > 0
  },

  async replaceFitnessGearComponent({ id, gearId, actorId, brand, model }) {
    return database.transaction(async (trx) => {
      const existing = await getOwnedComponentRow(trx, { id, gearId, actorId })
      // An already-removed part cannot be replaced — it is history, and the
      // part that succeeded it is the one on the bike.
      if (!existing || existing.removedAt) return null

      const currentTime = new Date()
      await trx('fitness_gear_components')
        .where('id', id)
        .update({ removedAt: currentTime, updatedAt: currentTime })

      const replacement: SQLFitnessGearComponent = {
        id: crypto.randomUUID(),
        gearId,
        componentType: existing.componentType,
        brand: brand === undefined ? null : brand,
        model: model === undefined ? null : model,
        addedAt: currentTime,
        removedAt: null,
        // The service interval belongs to the part slot, not the part: a new
        // chain wants reminding at the same distance the old one did.
        serviceDistanceMeters: existing.serviceDistanceMeters ?? null,
        lastAlertedDistanceMeters: null,
        createdAt: currentTime,
        updatedAt: currentTime,
        deletedAt: null
      }
      await trx('fitness_gear_components').insert(replacement)

      const retiredRow = await trx<SQLFitnessGearComponent>(
        'fitness_gear_components'
      )
        .where('id', id)
        .first()

      return {
        retired: parseSQLFitnessGearComponent(
          retiredRow ?? { ...existing, removedAt: currentTime }
        ),
        replacement: parseSQLFitnessGearComponent(replacement)
      }
    })
  },

  async getFitnessGearComponentDistanceRollups({ actorId, gearIds }) {
    const uniqueIds = [...new Set(gearIds)]
    const rollups: Record<string, FitnessGearDistanceRollup> = {}
    if (uniqueIds.length === 0) return rollups

    for (const chunk of chunkArray(
      uniqueIds,
      getWhereInBatchSize(database, 3)
    )) {
      // One grouped query covers every component of every gear in the chunk.
      // The install window lives in the JOIN condition rather than the WHERE
      // clause so a component with no matching activity still produces a row
      // (COUNT over the joined id then yields 0 instead of dropping it).
      //
      // `activityStartTime` is compared column-to-column against the window
      // bounds, which is safe on both backends because knex writes all three
      // columns in the same representation. Never introduce raw date
      // arithmetic here without an isSQLiteClient branch.
      //
      // An activity with a NULL `activityStartTime` (a GPX carrying no
      // timestamps) therefore counts only for a component whose window is open
      // on that side. That is intended: an activity that cannot be placed in
      // time cannot be placed inside `[addedAt, removedAt)` either, so a part
      // fitted on a date must not claim it. The consequence is that a gear
      // total can legitimately exceed the sum of its components' totals.
      const rows = await database('fitness_gear_components as c')
        .innerJoin('fitness_gears as g', 'g.id', 'c.gearId')
        .leftJoin('fitness_files as f', function () {
          this.on('f.gearId', '=', 'c.gearId')
            // Same actor scope the gear rollup applies. Not reachable today —
            // every caller resolves gear for the file's own actor — but without
            // it the two rollups disagree the moment one does not, and a
            // component total silently absorbing another actor's distance while
            // the gear total stays right is not a discrepancy anyone would
            // manage to reproduce.
            .andOn('f.actorId', '=', 'g.actorId')
            .andOnNull('f.deletedAt')
            .andOnVal('f.processingStatus', '=', 'completed')
            .andOnVal('f.isPrimary', '=', true)
            .andOn(function () {
              this.onNull('c.addedAt').orOn(
                'f.activityStartTime',
                '>=',
                'c.addedAt'
              )
            })
            .andOn(function () {
              this.onNull('c.removedAt').orOn(
                'f.activityStartTime',
                '<',
                'c.removedAt'
              )
            })
        })
        .where('g.actorId', actorId)
        .whereNull('g.deletedAt')
        .whereNull('c.deletedAt')
        .whereIn('c.gearId', chunk)
        .groupBy('c.id')
        .select(
          'c.id as componentId',
          database.raw('COUNT(??) as ??', ['f.id', 'activityCount']),
          database.raw('COALESCE(SUM(??), 0) as ??', [
            'f.totalDistanceMeters',
            'distanceMeters'
          ])
        )

      for (const row of rows as Record<string, unknown>[]) {
        rollups[String(row.componentId)] = {
          distanceMeters: Number(row.distanceMeters) || 0,
          activityCount: Number(row.activityCount) || 0
        }
      }
    }

    return rollups
  },

  async setFitnessGearComponentLastAlertedDistance({
    id,
    lastAlertedDistanceMeters,
    onlyIfBelowThresholdMeters
  }) {
    // See the gear-level twin: the conditional write is what makes concurrent
    // evaluations fire one reminder rather than one each.
    const query = database('fitness_gear_components')
      .where('id', id)
      .whereNull('deletedAt')
    if (onlyIfBelowThresholdMeters !== undefined) {
      query.where((builder) =>
        builder
          .whereNull('lastAlertedDistanceMeters')
          .orWhere('lastAlertedDistanceMeters', '<', onlyIfBelowThresholdMeters)
      )
    }

    const updated = await query.update({
      lastAlertedDistanceMeters,
      updatedAt: new Date()
    })
    return updated > 0
  },

  async setFitnessFileGear({ fitnessFileId, actorId, gearId }) {
    return database.transaction(async (trx) => {
      const file = await trx('fitness_files')
        .where('id', fitnessFileId)
        .where('actorId', actorId)
        .whereNull('deletedAt')
        .select('id')
        .first()
      if (!file) return null

      if (gearId) {
        // Retired gear stays assignable on purpose: retiring only takes gear
        // out of the pickers and auto-assign, and someone back-filling old
        // activities still needs to attribute them to the bike they sold.
        const gear = await getOwnedGearRow(trx, gearId, actorId)
        if (!gear) return null

        // A device is not something a ride was DONE on, and `gearId` is that
        // question. The picker already excludes devices, but this is the
        // enforcement point rather than the affordance: an activity attributed
        // to a device would leave every rollup at once — the device rollups
        // match on `deviceGearId`, the distance rollups skip devices entirely —
        // so its distance would count toward nothing, `assignFitnessFileGearIfUnset`
        // would refuse to auto-assign it ever again, and the status meta line
        // would name the head unit as the bike.
        if (gear.kind === 'device') return null
      }

      await trx('fitness_files')
        .where('id', fitnessFileId)
        .update({ gearId, updatedAt: new Date() })

      return { id: fitnessFileId, gearId }
    })
  },

  async assignFitnessFileGearIfUnset({ fitnessFileId, actorId, gearId }) {
    // Ownership is asserted as an EXISTS inside the same statement rather than
    // a read in front of it. Every caller resolves gear for the file's own
    // actor, but this is the one assignment path with no check of its own and a
    // file carrying another actor's gearId would corrupt both rollups.
    //
    // Folded in rather than a separate lookup because this runs once per
    // imported activity — a 5,000-ride archive would otherwise pay 5,000
    // redundant primary-key reads inside the import loop — and because a
    // check-then-write would still let gear deleted in between be written.
    // Retired gear deliberately passes: an import must be able to attribute a
    // ride to a bike that has since been sold.
    //
    // The `whereNull('gearId')` is the correctness guarantee, not an
    // optimisation: import jobs re-run, and a manual assignment made between a
    // caller's read and this write must survive.
    const updated = await database('fitness_files')
      .where('id', fitnessFileId)
      .where('actorId', actorId)
      .whereExists((builder) =>
        builder
          .select(database.raw('1'))
          .from('fitness_gears')
          .where('fitness_gears.id', gearId)
          .where('fitness_gears.actorId', actorId)
          .whereNull('fitness_gears.deletedAt')
          // The same rule `setFitnessFileGear` enforces: `gearId` is what the
          // ride was done on, never what recorded it. Unreachable through the
          // auto-assign path itself — a device can hold no default sport — but
          // `scripts/fitness/importFitnessGear.ts` also reaches here through a
          // NAME lookup, and device rows share that name space.
          .whereNot('fitness_gears.kind', 'device')
      )
      .whereNull('gearId')
      .whereNull('deletedAt')
      .update({ gearId, updatedAt: new Date() })
    return updated > 0
  }
})
