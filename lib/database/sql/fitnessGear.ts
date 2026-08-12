import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/sql/utils/knex'
import { FitnessGearKind } from '@/lib/services/fitness-files/sportTypes'
import {
  FitnessGear,
  FitnessGearComponent,
  FitnessGearDistanceRollup,
  SQLFitnessGear,
  SQLFitnessGearComponent
} from '@/lib/types/database/fitnessGear'

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
  stravaGearId?: string | null
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
  findFitnessGearByDefaultSport(params: {
    actorId: string
    sportKey: string
  }): Promise<FitnessGear | null>
  findFitnessGearByStravaGearId(params: {
    actorId: string
    stravaGearId: string
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
  stravaGearId: row.stravaGearId ?? undefined,
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
 * The activity filter both gear rollups share, copied from
 * `getFitnessActivitySummary` rather than re-derived so the totals line up with
 * the fitness overview.
 *
 * Not quite identical to that query, deliberately: the summary additionally
 * requires a non-null `activityType` and `activityStartTime` because it groups
 * and buckets by them. Gear totals count an activity whatever it is and whenever
 * it happened, so a timestamp-less GPX contributes here and is invisible there.
 */
const applyCountableActivityFilter = (
  query: Knex.QueryBuilder,
  tableAlias: string
) =>
  query
    .whereNull(`${tableAlias}.deletedAt`)
    .where(`${tableAlias}.processingStatus`, 'completed')
    .where(`${tableAlias}.isPrimary`, true)

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
        stravaGearId: params.stravaGearId ?? null,
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
          // Release the Strava id along with the row. The unique index on
          // (actorId, stravaGearId) covers soft-deleted rows, so a deleted gear
          // that kept its id would block the re-import forever: the lookup
          // filters on `deletedAt IS NULL` and finds nothing, the create then
          // violates the index, and the recovery re-read finds nothing either —
          // leaving every future activity on that bike silently unattributed
          // with no way for the owner to repair it.
          stravaGearId: null
        })
      if (deleted === 0) return false

      // Activities outlive their gear: they keep their own distance and simply
      // stop being attributed. Component rows are left in place — every read
      // joins through a non-deleted gear, so they are already unreachable.
      await trx('fitness_files')
        .where('gearId', id)
        .update({ gearId: null, updatedAt: currentTime })

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

  async findFitnessGearByStravaGearId({ actorId, stravaGearId }) {
    const row = await database<SQLFitnessGear>('fitness_gears')
      .where('actorId', actorId)
      .where('stravaGearId', stravaGearId)
      .whereNull('deletedAt')
      .first()
    return row ? parseSQLFitnessGear(row) : null
  },

  async findFitnessGearByName({ actorId, name }) {
    const trimmed = name.trim()
    if (!trimmed) return null

    // Case-insensitive without relying on a backend collation: the archive
    // importer keys on the name Strava exported, and per-actor gear counts are
    // small enough to compare in JS.
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
      )
      .whereNull('gearId')
      .whereNull('deletedAt')
      .update({ gearId, updatedAt: new Date() })
    return updated > 0
  }
})
