import crypto from 'crypto'

import { getGalleryAlbumItemSets } from '@/lib/database/domains/gallery/albumSuggestions'
import { getGalleryMediaFacetRows } from '@/lib/database/domains/gallery/facets'
import {
  getGalleryLookup,
  pruneGalleryLookups,
  putGalleryLookup
} from '@/lib/database/domains/gallery/lookupCache'
import {
  addMediaToGallery,
  getActorHasGalleryMedia,
  getGalleryGearUsageRows,
  getGalleryMapRows,
  getGalleryMedia,
  getGalleryMediaByIds,
  getGalleryMediaIndex,
  getUnattachedMedia
} from '@/lib/database/domains/gallery/media'
import { countGalleryMedia } from '@/lib/database/domains/gallery/mediaFilters'
import {
  asGalleryGearRow,
  asGallerySettingsRow,
  normalizeGalleryGearName,
  parseSQLGalleryGear,
  parseSQLGallerySettings
} from '@/lib/database/domains/gallery/rows'
import type {
  CreateGalleryGearParams,
  CreateGalleryGearWithinLimitParams,
  CreateGalleryGearWithinLimitResult,
  DeleteGalleryGearParams,
  FindGalleryGearByDeviceKeyParams,
  GetGalleryGearNamesByIdsParams,
  GetGalleryGearParams,
  GetGallerySettingsParams,
  SetGalleryGearRetiredParams,
  UpdateGalleryGearParams,
  UpdateGallerySettingsParams
} from '@/lib/database/domains/gallery/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/kysely/inList'
import {
  DEFAULT_GALLERY_SETTINGS,
  GalleryGear,
  GallerySettings,
  SQLGalleryGear
} from '@/lib/types/database/gallery'

// The gallery's gear and settings. The gallery media reads are in ./media.ts,
// the lookup cache in ./lookupCache.ts and the album suggestions' item read in
// ./albumSuggestions.ts; `galleryQueries` at the end holds all of them.

const readSettings = async (
  db: Db,
  actorId: string
): Promise<GallerySettings> => {
  const row = await db
    .selectFrom('gallery_settings')
    .selectAll()
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()

  return row
    ? parseSQLGallerySettings(asGallerySettingsRow(row))
    : { ...DEFAULT_GALLERY_SETTINGS }
}

const buildGearRow = (params: CreateGalleryGearParams): SQLGalleryGear => {
  const currentTime = new Date()
  return {
    id: crypto.randomUUID(),
    actorId: params.actorId,
    kind: params.kind,
    name: params.name,
    brand: params.brand ?? null,
    model: params.model ?? null,
    productUrl: params.productUrl ?? null,
    deviceKey: params.deviceKey ?? null,
    retiredAt: null,
    createdAt: currentTime,
    updatedAt: currentTime,
    deletedAt: null
  }
}

const insertGearRow = (db: Db, data: SQLGalleryGear) =>
  db
    .insertInto('gallery_gears')
    .values({
      id: data.id,
      actorId: data.actorId,
      kind: data.kind,
      name: data.name,
      brand: data.brand ?? null,
      model: data.model ?? null,
      productUrl: data.productUrl ?? null,
      deviceKey: data.deviceKey ?? null,
      retiredAt: null,
      createdAt: data.createdAt as Date,
      updatedAt: data.updatedAt as Date,
      deletedAt: null
    })
    .execute()

// The actor's own non-deleted gear row, or null.
const readOwnGear = async (
  db: Db,
  id: string,
  actorId: string
): Promise<GalleryGear | null> => {
  const row = await db
    .selectFrom('gallery_gears')
    .selectAll()
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()
  return row ? parseSQLGalleryGear(asGalleryGearRow(row)) : null
}

export const createGalleryGearWithinLimit = (
  db: Db,
  { limit, dedupeByName, ...params }: CreateGalleryGearWithinLimitParams
): Promise<CreateGalleryGearWithinLimitResult> =>
  inTransaction(
    db,
    async (trx): Promise<CreateGalleryGearWithinLimitResult> => {
      // Serialise one actor's gear creates on their actor row. SQLite's single
      // writer connection already serialises transactions, so the lock is
      // PostgreSQL-only.
      await forUpdate(
        trx,
        trx.selectFrom('actors').select('id').where('id', '=', params.actorId)
      ).execute()

      const rows = (
        await trx
          .selectFrom('gallery_gears')
          .selectAll()
          .where('actorId', '=', params.actorId)
          .where('deletedAt', 'is', null)
          .orderBy('createdAt', 'asc')
          .orderBy('id', 'asc')
          .execute()
      ).map(asGalleryGearRow)

      const requestedName = normalizeGalleryGearName(params.name)
      const existing = rows.find(
        (row) =>
          (params.deviceKey && row.deviceKey === params.deviceKey) ||
          (dedupeByName &&
            row.kind === params.kind &&
            normalizeGalleryGearName(row.name) === requestedName)
      )
      if (existing) {
        return { status: 'existing', gear: parseSQLGalleryGear(existing) }
      }
      if (rows.length >= limit) return { status: 'limit-reached' }

      const data = buildGearRow(params)
      await insertGearRow(trx, data)
      return { status: 'created', gear: parseSQLGalleryGear(data) }
    }
  )

export const createGalleryGear = async (
  db: Db,
  params: CreateGalleryGearParams
): Promise<GalleryGear> => {
  const data = buildGearRow(params)

  await insertGearRow(db, data)

  return parseSQLGalleryGear(data)
}

export const getGalleryGearsByActor = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<GalleryGear[]> => {
  const rows = await db
    .selectFrom('gallery_gears')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .orderBy('createdAt', 'asc')
    .orderBy('id', 'asc')
    .execute()

  return rows.map((row) => parseSQLGalleryGear(asGalleryGearRow(row)))
}

export const getGalleryGear = (
  db: Db,
  { id, actorId }: GetGalleryGearParams
): Promise<GalleryGear | null> => readOwnGear(db, id, actorId)

export const findGalleryGearByDeviceKey = async (
  db: Db,
  { actorId, deviceKey }: FindGalleryGearByDeviceKeyParams
): Promise<GalleryGear | null> => {
  const row = await db
    .selectFrom('gallery_gears')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('deviceKey', '=', deviceKey)
    .where('deletedAt', 'is', null)
    .limit(1)
    .executeTakeFirst()

  return row ? parseSQLGalleryGear(asGalleryGearRow(row)) : null
}

export const getGalleryGearNamesByIds = async (
  db: Db,
  { ids }: GetGalleryGearNamesByIdsParams
): Promise<Record<string, string>> => {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return {}

  const names: Record<string, string> = {}
  for (const chunk of chunkArray(uniqueIds, getWhereInBatchSize(db))) {
    const rows = await db
      .selectFrom('gallery_gears')
      .select(['id', 'name'])
      .where('id', 'in', chunk)
      .where('deletedAt', 'is', null)
      .execute()
    for (const row of rows) {
      names[row.id] = row.name
    }
  }

  return names
}

export const updateGalleryGear = async (
  db: Db,
  { id, actorId, ...fields }: UpdateGalleryGearParams
): Promise<GalleryGear | null> => {
  const patch: Record<string, unknown> = {}
  if (fields.name !== undefined) patch.name = fields.name
  for (const key of ['brand', 'model', 'productUrl'] as const) {
    if (fields[key] !== undefined) patch[key] = fields[key]
  }

  await db
    .updateTable('gallery_gears')
    .set({ ...patch, updatedAt: new Date() })
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .execute()

  // Zero affected rows means "no such gear of yours" as well as "nothing
  // changed", and the re-read tells them apart.
  return readOwnGear(db, id, actorId)
}

export const setGalleryGearRetired = async (
  db: Db,
  { id, actorId, retired }: SetGalleryGearRetiredParams
): Promise<GalleryGear | null> => {
  const currentTime = new Date()

  // The transition is a predicate on the UPDATE, not a decision taken from
  // a read in front of it: re-sending `{retired: true}` must not move the
  // date the owner put the gear away on, and two concurrent requests must
  // not both write.
  await db
    .updateTable('gallery_gears')
    .set({ retiredAt: retired ? currentTime : null, updatedAt: currentTime })
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .where('deletedAt', 'is', null)
    .where('retiredAt', retired ? 'is' : 'is not', null)
    .execute()

  return readOwnGear(db, id, actorId)
}

export const deleteGalleryGear = (
  db: Db,
  { id, actorId }: DeleteGalleryGearParams
): Promise<boolean> =>
  inTransaction(db, async (trx) => {
    const currentTime = new Date()
    const deleted = await trx
      .updateTable('gallery_gears')
      .set({
        deletedAt: currentTime,
        updatedAt: currentTime,
        // The `(actorId, deviceKey)` unique index covers soft-deleted rows,
        // so the key is released here or the next upload from this camera
        // could neither find nor re-create its gear.
        deviceKey: null
      })
      .where('id', '=', id)
      .where('actorId', '=', actorId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst()
    if (Number(deleted.numUpdatedRows) === 0) return false

    // Media outlives its gear. Scoped to the actor as well, so a stale
    // reference on somebody else's row is never rewritten.
    await trx
      .updateTable('medias')
      .set({ cameraGearId: null })
      .where('cameraGearId', '=', id)
      .where('actorId', '=', actorId)
      .execute()
    await trx
      .updateTable('medias')
      .set({ lensGearId: null })
      .where('lensGearId', '=', id)
      .where('actorId', '=', actorId)
      .execute()
    return true
  })

export const getGallerySettings = (
  db: Db,
  { actorId }: GetGallerySettingsParams
): Promise<GallerySettings> => readSettings(db, actorId)

export const updateGallerySettings = (
  db: Db,
  params: UpdateGallerySettingsParams
): Promise<GallerySettings> => {
  const { actorId, hiddenLocations, ...flags } = params
  const currentTime = new Date()

  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flags)) {
    if (value !== undefined) patch[key] = value
  }
  if (hiddenLocations !== undefined) {
    patch.hiddenLocations = JSON.stringify(hiddenLocations)
  }

  return inTransaction(db, async (trx) => {
    // Insert-if-missing then update, rather than a read followed by one of
    // the two: two first-ever saves racing both see "no row", and the loser's
    // insert would fail on the primary key.
    await trx
      .insertInto('gallery_settings')
      .values({ actorId, createdAt: currentTime, updatedAt: currentTime })
      .onConflict((oc) => oc.column('actorId').doNothing())
      .execute()

    await trx
      .updateTable('gallery_settings')
      .set({ ...patch, updatedAt: currentTime })
      .where('actorId', '=', actorId)
      .execute()

    return readSettings(trx, actorId)
  })
}

// The facade getSQLDatabase binds with bindDb().
export const galleryQueries = {
  createGalleryGearWithinLimit,
  createGalleryGear,
  getGalleryGearsByActor,
  getGalleryGear,
  findGalleryGearByDeviceKey,
  getGalleryGearNamesByIds,
  updateGalleryGear,
  setGalleryGearRetired,
  deleteGalleryGear,
  getGallerySettings,
  updateGallerySettings,
  getActorHasGalleryMedia,
  getGalleryMedia,
  countGalleryMedia,
  getGalleryMediaFacetRows,
  getGalleryMediaByIds,
  getGalleryMediaIndex,
  getGalleryMapRows,
  getGalleryGearUsageRows,
  getUnattachedMedia,
  addMediaToGallery,
  getGalleryLookup,
  putGalleryLookup,
  pruneGalleryLookups,
  getGalleryAlbumItemSets
}
