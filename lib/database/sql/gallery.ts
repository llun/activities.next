import crypto from 'crypto'
import { Knex } from 'knex'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/sql/utils/knex'
import {
  DEFAULT_GALLERY_SETTINGS,
  GALLERY_DEFAULTS,
  GalleryDefault,
  GalleryGear,
  GalleryGearKind,
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
  hiddenLocations?: unknown[]
}

export interface GalleryDatabase {
  createGalleryGear(params: CreateGalleryGearParams): Promise<GalleryGear>
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

const parseHiddenLocations = (value: string | null | undefined): unknown[] => {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
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

  return {
    async createGalleryGear(params) {
      const currentTime = new Date()
      const data: SQLGalleryGear = {
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
