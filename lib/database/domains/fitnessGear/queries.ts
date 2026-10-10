import crypto from 'crypto'
import type { Updateable } from 'kysely'

import { fitnessGearComponentQueries } from '@/lib/database/domains/fitnessGear/components'
import {
  type GearRow,
  getOwnedGearRow,
  normalizeOptionalNumber,
  parseDefaultSports,
  toFitnessGear
} from '@/lib/database/domains/fitnessGear/rows'
import type {
  CreateFitnessGearParams,
  FitnessGearActivity,
  UpdateFitnessGearParams
} from '@/lib/database/domains/fitnessGear/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { countableActivity } from '@/lib/database/kysely/countableActivity'
import type { EpochMs, FitnessGears } from '@/lib/database/kysely/db'
import { selectInChunks } from '@/lib/database/kysely/inList'
import { toEpochMilliseconds } from '@/lib/database/kysely/normalize'
import type { FitnessGearKind } from '@/lib/services/fitness-files/sportTypes'
import type {
  FitnessGear,
  FitnessGearDeviceRollup,
  FitnessGearDistanceRollup
} from '@/lib/types/database/fitnessGear'

/**
 * A sport can be the default of at most one of an actor's gears. Picking it for
 * a new gear therefore takes it away from whichever gear held it.
 *
 * The invariant covers every non-deleted gear, retired ones included: scoping
 * it to active gear would let unretiring produce two holders of the same sport,
 * and then auto-assign would have to pick arbitrarily between them.
 */
const stealDefaultSports = async (
  trx: Db,
  actorId: string,
  sportKeys: string[],
  exceptGearId?: string
) => {
  if (sportKeys.length === 0) return

  const claimed = new Set(sportKeys)
  const rows = await trx
    .selectFrom('fitness_gears')
    .select(['id', 'defaultSports'])
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .where('defaultSports', 'is not', null)
    .$if(Boolean(exceptGearId), (qb) => qb.where('id', '<>', exceptGearId!))
    .execute()

  const currentTime = new Date()
  for (const row of rows) {
    const existing = parseDefaultSports(row.defaultSports)
    const remaining = existing.filter((key) => !claimed.has(key))
    if (remaining.length === existing.length) continue

    await trx
      .updateTable('fitness_gears')
      .set({
        defaultSports: JSON.stringify(remaining),
        updatedAt: currentTime
      })
      .where('id', '=', row.id)
      .execute()
  }
}

export const createFitnessGear = (
  db: Db,
  params: CreateFitnessGearParams
): Promise<FitnessGear> =>
  inTransaction(db, async (trx) => {
    const currentTime = new Date()
    const defaultSports = params.defaultSports ?? []

    await stealDefaultSports(trx, params.actorId, defaultSports)

    const values = {
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

    await trx.insertInto('fitness_gears').values(values).execute()

    // The values as written, not re-read: the same answer the insert gives.
    const time = currentTime.getTime() as EpochMs
    return toFitnessGear({ ...values, createdAt: time, updatedAt: time })
  })

export const getFitnessGear = async (
  db: Db,
  { id, actorId }: { id: string; actorId: string }
): Promise<FitnessGear | null> => {
  const row = await getOwnedGearRow(db, id, actorId)
  return row ? toFitnessGear(row) : null
}

// The actor's gear oldest first, deleted ones left out.
const getActorGearRows = (
  db: Db,
  actorId: string,
  { activeWithDefaultSports = false } = {}
): Promise<GearRow[]> =>
  db
    .selectFrom('fitness_gears')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .$if(activeWithDefaultSports, (qb) =>
      qb.where('retiredAt', 'is', null).where('defaultSports', 'is not', null)
    )
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute()

export const getFitnessGearsByActor = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<FitnessGear[]> =>
  (await getActorGearRows(db, actorId)).map(toFitnessGear)

export const getFitnessGearNamesByIds = async (
  db: Db,
  { ids }: { ids: string[] }
): Promise<Record<string, string>> => {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return {}

  const rows = await selectInChunks(db, uniqueIds, (chunk) =>
    db
      .selectFrom('fitness_gears')
      .select(['id', 'name'])
      .where('id', 'in', chunk)
      .where('deletedAt', 'is', null)
      .execute()
  )
  const names: Record<string, string> = {}
  for (const row of rows) {
    names[row.id] = row.name
  }
  return names
}

export const updateFitnessGear = (
  db: Db,
  params: UpdateFitnessGearParams
): Promise<FitnessGear | null> =>
  inTransaction(db, async (trx) => {
    const existing = await getOwnedGearRow(trx, params.id, params.actorId)
    if (!existing) return null

    const updateData: Updateable<FitnessGears> = { updatedAt: new Date() }

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

    await trx
      .updateTable('fitness_gears')
      .set(updateData)
      .where('id', '=', params.id)
      .execute()

    const updated = await getOwnedGearRow(trx, params.id, params.actorId)
    return updated ? toFitnessGear(updated) : null
  })

export const setFitnessGearRetired = async (
  db: Db,
  { id, actorId, retired }: { id: string; actorId: string; retired: boolean }
): Promise<FitnessGear | null> => {
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
  await db
    .updateTable('fitness_gears')
    .set({
      retiredAt: retired ? currentTime : null,
      // Retiring freezes the total and unretiring resumes it; either way the
      // next crossing is a fresh one.
      lastAlertedDistanceMeters: null,
      updatedAt: currentTime
    })
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .where('retiredAt', retired ? 'is' : 'is not', null)
    .execute()

  // Deliberately not keyed on the affected-row count: zero rows means either
  // "already in that state" (a successful no-op, which must return the gear)
  // or "no such gear of yours" (null). The re-read tells them apart, and it
  // is the same read the success path needs anyway.
  const row = await getOwnedGearRow(db, id, actorId)
  return row ? toFitnessGear(row) : null
}

export const deleteFitnessGear = (
  db: Db,
  { id, actorId }: { id: string; actorId: string }
): Promise<boolean> =>
  inTransaction(db, async (trx) => {
    const currentTime = new Date()
    const deleted = await trx
      .updateTable('fitness_gears')
      .set({
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
      .where('id', '=', id)
      .where('actorId', '=', actorId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst()
    if (Number(deleted.numUpdatedRows) === 0) return false

    // Activities outlive their gear: they keep their own distance and simply
    // stop being attributed. Component rows are left in place — every read
    // joins through a non-deleted gear, so they are already unreachable.
    await trx
      .updateTable('fitness_files')
      .set({ gearId: null, updatedAt: currentTime })
      .where('gearId', '=', id)
      .execute()

    // The device link is a separate column and is detached the same way: an
    // activity keeps the `deviceName`/`deviceManufacturer` it was recorded
    // with and simply stops pointing at a row that no longer exists.
    await trx
      .updateTable('fitness_files')
      .set({ deviceGearId: null, updatedAt: currentTime })
      .where('deviceGearId', '=', id)
      .execute()

    return true
  })

export const getFitnessGearDistanceRollups = async (
  db: Db,
  { actorId, gearIds }: { actorId: string; gearIds: string[] }
): Promise<Record<string, FitnessGearDistanceRollup>> => {
  const uniqueIds = [...new Set(gearIds)]
  const rollups: Record<string, FitnessGearDistanceRollup> = {}
  for (const gearId of uniqueIds) {
    rollups[gearId] = { distanceMeters: 0, activityCount: 0 }
  }
  if (uniqueIds.length === 0) return rollups

  const rows = await selectInChunks(
    db,
    uniqueIds,
    (chunk) =>
      db
        .selectFrom('fitness_files')
        .select((eb) => [
          'fitness_files.gearId as gearId',
          eb.fn.countAll().as('activityCount'),
          eb.fn
            .coalesce(eb.fn.sum('fitness_files.totalDistanceMeters'), eb.lit(0))
            .as('distanceMeters')
        ])
        .where((eb) => countableActivity(eb))
        .where('fitness_files.actorId', '=', actorId)
        .where('fitness_files.gearId', 'in', chunk)
        .groupBy('fitness_files.gearId')
        .execute(),
    // `actorId`, `'completed'` and `isPrimary`.
    3
  )
  for (const row of rows) {
    rollups[String(row.gearId)] = {
      // Aggregates carry no declared type on SQLite, so they are converted
      // here rather than by the driver.
      distanceMeters: Number(row.distanceMeters) || 0,
      activityCount: Number(row.activityCount) || 0
    }
  }

  return rollups
}

export const getFitnessGearDeviceRollups = async (
  db: Db,
  { actorId, gearIds }: { actorId: string; gearIds: string[] }
): Promise<Record<string, FitnessGearDeviceRollup>> => {
  const uniqueIds = [...new Set(gearIds)]
  const rollups: Record<string, FitnessGearDeviceRollup> = {}
  // Pre-seeded with zeros so a device with nothing linked yet still gets a
  // row, exactly like the distance rollup — the caller must never have to
  // tell "no activities" apart from "no such gear".
  for (const gearId of uniqueIds) {
    rollups[gearId] = { activityCount: 0, firstUsedAt: null }
  }
  if (uniqueIds.length === 0) return rollups

  // The same countable-activity predicate the distance rollups use, with
  // `isPrimary` replaced by the per-ride-per-device rule — see the predicate's
  // own comment.
  const rows = await selectInChunks(
    db,
    uniqueIds,
    (chunk) =>
      db
        .selectFrom('fitness_files')
        .select((eb) => [
          'fitness_files.deviceGearId as deviceGearId',
          eb.fn.countAll().as('activityCount'),
          // Distance is deliberately not summed: a device records rides and
          // runs alike, so a combined total would be a number with no meaning.
          eb.fn.min('fitness_files.activityStartTime').as('firstUsedAt')
        ])
        .where((eb) => countableActivity(eb, { forDeviceLink: true }))
        .where('fitness_files.actorId', '=', actorId)
        .where('fitness_files.deviceGearId', 'in', chunk)
        .groupBy('fitness_files.deviceGearId')
        .execute(),
    // The same reserve as before the port: the per-ride-per-device predicate
    // binds `'completed'` twice plus two booleans on top of `actorId`, and
    // SQLite counts every one of them toward its 999-variable ceiling.
    8
  )
  for (const row of rows) {
    rollups[String(row.deviceGearId)] = {
      activityCount: Number(row.activityCount) || 0,
      // MIN of a timestamp keeps its type on PostgreSQL, so the driver hands
      // back epoch milliseconds; on SQLite it is the stored value as is. Null
      // when every linked activity is timestamp-less.
      firstUsedAt: toEpochMilliseconds(row.firstUsedAt)
    }
  }

  return rollups
}

export const getFitnessGearActivities = async (
  db: Db,
  {
    actorId,
    gearId,
    kind,
    limit,
    offset = 0
  }: {
    actorId: string
    gearId: string
    kind: FitnessGearKind
    limit: number
    offset?: number
  }
): Promise<FitnessGearActivity[]> => {
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
  const rows = await db
    .selectFrom('fitness_files')
    .select(['fitness_files.id as id', 'fitness_files.statusId as statusId'])
    // Matches this kind's rollup exactly, so the only thing that can
    // separate the count from what the page shows is an activity whose post
    // was deleted — still a row here and still counted there, with no post
    // left to render.
    .where((eb) => countableActivity(eb, { forDeviceLink: isDevice }))
    .where('fitness_files.actorId', '=', actorId)
    .where(matchColumn, '=', gearId)
    // Sorting the timestamp-less activities last is load-bearing rather than
    // tidy: under DESC the two backends disagree on where NULLs land
    // (PostgreSQL puts them first, SQLite last), so a GPX carrying no
    // timestamps would head the list on one backend and tail it on the other
    // — and paginate inconsistently. `nulls last` says it on both.
    .orderBy('fitness_files.activityStartTime', (ob) => ob.desc().nullsLast())
    .orderBy('fitness_files.createdAt', 'desc')
    // A stable tiebreak: two activities imported in the same batch can share
    // both timestamps, and an unordered pair would repeat or skip a row
    // across pages.
    .orderBy('fitness_files.id', 'desc')
    .limit(limit)
    .offset(offset)
    .execute()

  return rows.map((row) => ({ id: row.id, statusId: row.statusId ?? null }))
}

export const findFitnessGearByDeviceKey = async (
  db: Db,
  { actorId, deviceKey }: { actorId: string; deviceKey: string }
): Promise<FitnessGear | null> => {
  // Soft-deleted rows are excluded here and their key is released on delete,
  // so a device someone removed is recreated from scratch on its next upload
  // rather than resurrecting with the notes and name they threw away.
  const row = await db
    .selectFrom('fitness_gears')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('deviceKey', '=', deviceKey)
    .where('deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()

  return row ? toFitnessGear(row) : null
}

export const findFitnessGearByDefaultSport = async (
  db: Db,
  { actorId, sportKey }: { actorId: string; sportKey: string }
): Promise<FitnessGear | null> => {
  // Active gear only — retired gear is out of auto-assign by definition.
  // The per-actor gear count is tiny and `defaultSports` is a JSON string, so
  // matching in JS beats a backend-specific JSON operator.
  const rows = await getActorGearRows(db, actorId, {
    activeWithDefaultSports: true
  })

  const match = rows.find((row) =>
    parseDefaultSports(row.defaultSports).includes(sportKey)
  )
  return match ? toFitnessGear(match) : null
}

export const findFitnessGearByName = async (
  db: Db,
  { actorId, name }: { actorId: string; name: string }
): Promise<FitnessGear | null> => {
  const trimmed = name.trim()
  if (!trimmed) return null

  // Case-insensitive without relying on a backend collation: the gear
  // import script keys on the name in its plan file, and per-actor gear
  // counts are small enough to compare in JS.
  const normalized = trimmed.toLowerCase()
  const rows = await getActorGearRows(db, actorId)

  const match = rows.find((row) => row.name.trim().toLowerCase() === normalized)
  return match ? toFitnessGear(match) : null
}

export const setFitnessGearLastAlertedDistance = async (
  db: Db,
  {
    id,
    lastAlertedDistanceMeters,
    onlyIfBelowThresholdMeters
  }: {
    id: string
    lastAlertedDistanceMeters: number | null
    onlyIfBelowThresholdMeters?: number
  }
): Promise<boolean> => {
  // With `onlyIfBelowThresholdMeters` the UPDATE itself decides whether this
  // caller won the crossing, so two evaluations racing on the same gear (two
  // queued imports, a same-ride two-device upload) produce one notification
  // instead of two. Without it, both would read the same stale null.
  const result = await db
    .updateTable('fitness_gears')
    .set({ lastAlertedDistanceMeters, updatedAt: new Date() })
    .where('id', '=', id)
    .where('deletedAt', 'is', null)
    .$if(onlyIfBelowThresholdMeters !== undefined, (qb) =>
      qb.where((eb) =>
        eb.or([
          eb('lastAlertedDistanceMeters', 'is', null),
          eb('lastAlertedDistanceMeters', '<', onlyIfBelowThresholdMeters!)
        ])
      )
    )
    .executeTakeFirst()
  return Number(result.numUpdatedRows) > 0
}

export const setFitnessFileGear = (
  db: Db,
  {
    fitnessFileId,
    actorId,
    gearId
  }: { fitnessFileId: string; actorId: string; gearId: string | null }
): Promise<{ id: string; gearId: string | null } | null> =>
  inTransaction(db, async (trx) => {
    const file = await trx
      .selectFrom('fitness_files')
      .select('id')
      .where('id', '=', fitnessFileId)
      .where('actorId', '=', actorId)
      .where('deletedAt', 'is', null)
      .limit(1)
      .executeTakeFirst()
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

    await trx
      .updateTable('fitness_files')
      .set({ gearId, updatedAt: new Date() })
      .where('id', '=', fitnessFileId)
      .execute()

    return { id: fitnessFileId, gearId }
  })

export const assignFitnessFileGearIfUnset = async (
  db: Db,
  {
    fitnessFileId,
    actorId,
    gearId
  }: { fitnessFileId: string; actorId: string; gearId: string }
): Promise<boolean> => {
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
  // The `gearId is null` is the correctness guarantee, not an optimisation:
  // import jobs re-run, and a manual assignment made between a caller's read
  // and this write must survive.
  const result = await db
    .updateTable('fitness_files')
    .set({ gearId, updatedAt: new Date() })
    .where('id', '=', fitnessFileId)
    .where('actorId', '=', actorId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('fitness_gears')
          .select(eb.lit(1).as('one'))
          .where('fitness_gears.id', '=', gearId)
          .where('fitness_gears.actorId', '=', actorId)
          .where('fitness_gears.deletedAt', 'is', null)
          // The same rule `setFitnessFileGear` enforces: `gearId` is what the
          // ride was done on, never what recorded it. Unreachable through the
          // auto-assign path itself — a device can hold no default sport — but
          // `scripts/fitness/importFitnessGear.ts` also reaches here through a
          // NAME lookup, and device rows share that name space.
          .where('fitness_gears.kind', '<>', 'device')
      )
    )
    .where('gearId', 'is', null)
    .where('deletedAt', 'is', null)
    .executeTakeFirst()
  return Number(result.numUpdatedRows) > 0
}

// The facade getSQLDatabase binds with bindDb(): the gear methods and the
// component methods in ./components.
export const fitnessGearQueries = {
  createFitnessGear,
  getFitnessGear,
  getFitnessGearsByActor,
  getFitnessGearNamesByIds,
  updateFitnessGear,
  setFitnessGearRetired,
  deleteFitnessGear,
  getFitnessGearDistanceRollups,
  getFitnessGearDeviceRollups,
  getFitnessGearActivities,
  findFitnessGearByDeviceKey,
  findFitnessGearByDefaultSport,
  findFitnessGearByName,
  setFitnessGearLastAlertedDistance,
  setFitnessFileGear,
  assignFitnessFileGearIfUnset,
  ...fitnessGearComponentQueries
}
