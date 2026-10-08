import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  chunkArray,
  getWhereInBatchSize,
  isPostgresClient
} from '@/lib/database/sql/utils/knex'
import { parseGalleryHiddenLocations } from '@/lib/services/gallery/hiddenLocations'
import {
  DEFAULT_GALLERY_SETTINGS,
  GALLERY_DEFAULTS,
  GalleryDefault,
  GalleryGear,
  GalleryGearKind,
  GalleryHiddenLocation,
  GallerySettings,
  MEDIA_PLACE_PRECISIONS,
  MediaPlacePrecision,
  SQLGalleryGear,
  SQLGallerySettings
} from '@/lib/types/database/gallery'

export interface CreateGalleryGearParams {
  actorId: string
  kind: GalleryGearKind
  name: string
  brand?: string | null
  model?: string | null
  productUrl?: string | null
  // Create-only: the identity every later upload resolves against.
  deviceKey?: string | null
}

export interface CreateGalleryGearWithinLimitParams extends CreateGalleryGearParams {
  // The most non-deleted gear rows the actor may hold; at or past it nothing
  // is inserted.
  limit: number
  // Hand back a non-deleted row of the same kind and normalised name instead
  // of adding a twin (the manual `POST /api/v1/gallery/gears` path, whose rows
  // carry no `deviceKey` to be unique on).
  dedupeByName?: boolean
}

export type CreateGalleryGearWithinLimitResult =
  | { status: 'created'; gear: GalleryGear }
  | { status: 'existing'; gear: GalleryGear }
  | { status: 'limit-reached' }

/** Trims, collapses whitespace runs and lowercases a gear name. */
export const normalizeGalleryGearName = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLowerCase()

export interface GetGalleryGearParams {
  id: string
  actorId: string
}

export interface FindGalleryGearByDeviceKeyParams {
  actorId: string
  deviceKey: string
}

export interface GetGalleryGearNamesByIdsParams {
  ids: string[]
}

// Presence semantics: an omitted key is left alone; `null` clears the optional
// ones. `kind` and `deviceKey` are never editable.
export interface UpdateGalleryGearParams {
  id: string
  actorId: string
  name?: string
  brand?: string | null
  model?: string | null
  productUrl?: string | null
}

export interface SetGalleryGearRetiredParams {
  id: string
  actorId: string
  retired: boolean
}

export interface DeleteGalleryGearParams {
  id: string
  actorId: string
}

export interface GetGallerySettingsParams {
  actorId: string
}

// Presence semantics: an omitted key is left alone.
export interface UpdateGallerySettingsParams {
  actorId: string
  autoDescribe?: boolean
  allowEmptyDescription?: boolean
  subjectHashtags?: boolean
  galleryDefault?: GalleryDefault
  defaultPlacePrecision?: MediaPlacePrecision
  showGear?: boolean
  mapPublic?: boolean
  lifeListPublic?: boolean
  hiddenLocations?: GalleryHiddenLocation[]
}

export interface GalleryDatabase {
  createGalleryGear(params: CreateGalleryGearParams): Promise<GalleryGear>
  // `createGalleryGear` behind the per-actor cap and an existing-row check,
  // decided and written in one transaction serialised on the actor row, so
  // concurrent creates can neither overshoot the cap nor insert twins.
  createGalleryGearWithinLimit(
    params: CreateGalleryGearWithinLimitParams
  ): Promise<CreateGalleryGearWithinLimitResult>
  // RULE FOR ANY FUTURE DELETE PATH: `gallery_gears` is soft-deleted but its
  // `(actorId, deviceKey)` unique index covers deleted rows, while
  // `findGalleryGearByDeviceKey` skips them. A delete must therefore set
  // `deviceKey = null` in the same update as `deletedAt` (mirroring
  // `fitnessGear.ts`), or the next upload from that camera can neither find
  // nor re-create its gear.
  // Non-deleted gear of the actor, oldest first.
  getGalleryGearsByActor(params: { actorId: string }): Promise<GalleryGear[]>
  getGalleryGear(params: GetGalleryGearParams): Promise<GalleryGear | null>
  findGalleryGearByDeviceKey(
    params: FindGalleryGearByDeviceKeyParams
  ): Promise<GalleryGear | null>
  // `id -> name` for non-deleted gear, whoever owns it. Callers only pass ids
  // read off a media row, so there is nothing to scope by.
  getGalleryGearNamesByIds(
    params: GetGalleryGearNamesByIdsParams
  ): Promise<Record<string, string>>
  // The owner's own non-deleted gear only; null for a missing or foreign id.
  updateGalleryGear(
    params: UpdateGalleryGearParams
  ): Promise<GalleryGear | null>
  // Idempotent: a repeat does not move `retiredAt`. Null for a missing or
  // foreign id.
  setGalleryGearRetired(
    params: SetGalleryGearRetiredParams
  ): Promise<GalleryGear | null>
  // Soft-deletes, releases the `deviceKey` and detaches the actor's media from
  // the gear. False for a missing or foreign id.
  deleteGalleryGear(params: DeleteGalleryGearParams): Promise<boolean>
  // Always resolves: an actor with no row gets the defaults.
  getGallerySettings(params: GetGallerySettingsParams): Promise<GallerySettings>
  updateGallerySettings(
    params: UpdateGallerySettingsParams
  ): Promise<GallerySettings>
}

const parseSQLGalleryGear = (row: SQLGalleryGear): GalleryGear => ({
  id: row.id,
  actorId: row.actorId,
  kind: row.kind,
  name: row.name,
  brand: row.brand ?? undefined,
  model: row.model ?? undefined,
  productUrl: row.productUrl ?? undefined,
  deviceKey: row.deviceKey ?? undefined,
  retiredAt: row.retiredAt ? getCompatibleTime(row.retiredAt) : undefined,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt),
  deletedAt: row.deletedAt ? getCompatibleTime(row.deletedAt) : undefined
})

// A missing, corrupt or hand-edited column reads as the zones that survive
// `parseGalleryHiddenLocations`, never as a raw blob: every public projection
// trusts this shape.
const parseHiddenLocations = (
  value: string | null | undefined
): GalleryHiddenLocation[] => {
  if (!value) return []
  try {
    return parseGalleryHiddenLocations(JSON.parse(value))
  } catch {
    return []
  }
}

const parseSQLGallerySettings = (row: SQLGallerySettings): GallerySettings => ({
  autoDescribe: Boolean(row.autoDescribe),
  allowEmptyDescription: Boolean(row.allowEmptyDescription),
  subjectHashtags: Boolean(row.subjectHashtags),
  galleryDefault: (GALLERY_DEFAULTS as readonly string[]).includes(
    row.galleryDefault
  )
    ? (row.galleryDefault as GalleryDefault)
    : DEFAULT_GALLERY_SETTINGS.galleryDefault,
  defaultPlacePrecision: (MEDIA_PLACE_PRECISIONS as readonly string[]).includes(
    row.defaultPlacePrecision
  )
    ? (row.defaultPlacePrecision as MediaPlacePrecision)
    : DEFAULT_GALLERY_SETTINGS.defaultPlacePrecision,
  showGear: Boolean(row.showGear),
  mapPublic: Boolean(row.mapPublic),
  lifeListPublic: Boolean(row.lifeListPublic),
  hiddenLocations: parseHiddenLocations(row.hiddenLocations)
})

export const GallerySQLDatabaseMixin = (database: Knex): GalleryDatabase => {
  const readSettings = async (
    actorId: string,
    executor: Knex | Knex.Transaction = database
  ): Promise<GallerySettings> => {
    const row = await executor<SQLGallerySettings>('gallery_settings')
      .where('actorId', actorId)
      .first()

    return row ? parseSQLGallerySettings(row) : { ...DEFAULT_GALLERY_SETTINGS }
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

  return {
    async createGalleryGearWithinLimit({ limit, dedupeByName, ...params }) {
      return database.transaction(
        async (trx): Promise<CreateGalleryGearWithinLimitResult> => {
          // Serialise one actor's gear creates on their actor row, as
          // `createCollection` does. SQLite's single writer connection already
          // serialises transactions, so the lock is PostgreSQL-only.
          const lock = trx('actors').where({ id: params.actorId }).select('id')
          if (isPostgresClient(database)) lock.forUpdate()
          await lock

          const rows = await trx<SQLGalleryGear>('gallery_gears')
            .where('actorId', params.actorId)
            .whereNull('deletedAt')
            .orderBy('createdAt', 'asc')
            .orderBy('id', 'asc')

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
          await trx('gallery_gears').insert(data)
          return { status: 'created', gear: parseSQLGalleryGear(data) }
        }
      )
    },

    async createGalleryGear(params) {
      const data = buildGearRow(params)

      await database('gallery_gears').insert(data)

      return parseSQLGalleryGear(data)
    },

    async getGalleryGearsByActor({ actorId }) {
      const rows = await database<SQLGalleryGear>('gallery_gears')
        .where('actorId', actorId)
        .whereNull('deletedAt')
        .orderBy('createdAt', 'asc')
        .orderBy('id', 'asc')

      return rows.map(parseSQLGalleryGear)
    },

    async getGalleryGear({ id, actorId }) {
      const row = await database<SQLGalleryGear>('gallery_gears')
        .where('id', id)
        .where('actorId', actorId)
        .whereNull('deletedAt')
        .first()

      return row ? parseSQLGalleryGear(row) : null
    },

    async findGalleryGearByDeviceKey({ actorId, deviceKey }) {
      const row = await database<SQLGalleryGear>('gallery_gears')
        .where('actorId', actorId)
        .where('deviceKey', deviceKey)
        .whereNull('deletedAt')
        .first()

      return row ? parseSQLGalleryGear(row) : null
    },

    async getGalleryGearNamesByIds({ ids }) {
      const uniqueIds = [...new Set(ids)]
      if (uniqueIds.length === 0) return {}

      const names: Record<string, string> = {}
      for (const chunk of chunkArray(
        uniqueIds,
        getWhereInBatchSize(database)
      )) {
        const rows = await database<SQLGalleryGear>('gallery_gears')
          .whereIn('id', chunk)
          .whereNull('deletedAt')
          .select('id', 'name')
        for (const row of rows) {
          names[row.id] = row.name
        }
      }

      return names
    },

    async updateGalleryGear({ id, actorId, ...fields }) {
      const patch: Record<string, unknown> = {}
      if (fields.name !== undefined) patch.name = fields.name
      for (const key of ['brand', 'model', 'productUrl'] as const) {
        if (fields[key] !== undefined) patch[key] = fields[key]
      }

      await database('gallery_gears')
        .where('id', id)
        .where('actorId', actorId)
        .whereNull('deletedAt')
        .update({ ...patch, updatedAt: new Date() })

      // Zero affected rows means "no such gear of yours" as well as "nothing
      // changed", and the re-read tells them apart.
      const row = await database<SQLGalleryGear>('gallery_gears')
        .where('id', id)
        .where('actorId', actorId)
        .whereNull('deletedAt')
        .first()
      return row ? parseSQLGalleryGear(row) : null
    },

    async setGalleryGearRetired({ id, actorId, retired }) {
      const currentTime = new Date()

      // The transition is a predicate on the UPDATE, not a decision taken from
      // a read in front of it: re-sending `{retired: true}` must not move the
      // date the owner put the gear away on, and two concurrent requests must
      // not both write.
      const query = database('gallery_gears')
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
        updatedAt: currentTime
      })

      const row = await database<SQLGalleryGear>('gallery_gears')
        .where('id', id)
        .where('actorId', actorId)
        .whereNull('deletedAt')
        .first()
      return row ? parseSQLGalleryGear(row) : null
    },

    async deleteGalleryGear({ id, actorId }) {
      return database.transaction(async (trx) => {
        const currentTime = new Date()
        const deleted = await trx('gallery_gears')
          .where('id', id)
          .where('actorId', actorId)
          .whereNull('deletedAt')
          .update({
            deletedAt: currentTime,
            updatedAt: currentTime,
            // The `(actorId, deviceKey)` unique index covers soft-deleted rows,
            // so the key is released here or the next upload from this camera
            // could neither find nor re-create its gear.
            deviceKey: null
          })
        if (deleted === 0) return false

        // Media outlives its gear. Scoped to the actor as well, so a stale
        // reference on somebody else's row is never rewritten.
        await trx('medias')
          .where('cameraGearId', id)
          .where('actorId', actorId)
          .update({ cameraGearId: null })
        await trx('medias')
          .where('lensGearId', id)
          .where('actorId', actorId)
          .update({ lensGearId: null })
        return true
      })
    },

    async getGallerySettings({ actorId }) {
      return readSettings(actorId)
    },

    async updateGallerySettings(params) {
      const { actorId, hiddenLocations, ...flags } = params
      const currentTime = new Date()

      const patch: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(flags)) {
        if (value !== undefined) patch[key] = value
      }
      if (hiddenLocations !== undefined) {
        patch.hiddenLocations = JSON.stringify(hiddenLocations)
      }

      return database.transaction(async (trx) => {
        // Insert-if-missing then update, rather than a read followed by one of
        // the two: two first-ever saves racing both see "no row", and the loser's
        // insert would fail on the primary key.
        await trx('gallery_settings')
          .insert({ actorId, createdAt: currentTime, updatedAt: currentTime })
          .onConflict('actorId')
          .ignore()

        await trx('gallery_settings')
          .where('actorId', actorId)
          .update({ ...patch, updatedAt: currentTime })

        return readSettings(actorId, trx)
      })
    }
  }
}
