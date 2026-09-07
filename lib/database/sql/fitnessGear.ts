import crypto from 'crypto'
import { Knex } from 'knex'

import { FitnessGearComponentsSQLDatabaseMixin } from '@/lib/database/sql/fitnessGearComponents'
import {
  getOwnedGearRow,
  normalizeOptionalNumber,
  parseDefaultSports,
  parseSQLFitnessGear
} from '@/lib/database/sql/fitnessGearRows'
import {
  CreateFitnessGearParams,
  FitnessGearDatabase,
  UpdateFitnessGearParams
} from '@/lib/database/sql/fitnessGearTypes'
import { applyCountableActivityFilter } from '@/lib/database/sql/utils/countableActivity'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/sql/utils/knex'
import {
  FitnessGearDeviceRollup,
  FitnessGearDistanceRollup,
  SQLFitnessGear
} from '@/lib/types/database/fitnessGear'

export * from './fitnessGearTypes'
export * from './fitnessGearRows'
export * from './fitnessGearComponents'

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

export const FitnessGearSQLDatabaseMixin = (
  database: Knex
): FitnessGearDatabase => ({
  ...FitnessGearComponentsSQLDatabaseMixin(database),

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
