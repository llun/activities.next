import crypto from 'crypto'
import { Knex } from 'knex'

import { lockGalleryAlbumActor } from '@/lib/database/sql/galleryAlbumCleanup'
import {
  GALLERY_INDEX_COLUMNS,
  GalleryIndexRow,
  GalleryMediaRow,
  GalleryMediaSQLDatabaseMixin,
  buildGalleryMediaScope,
  normalizeLimit,
  parseNullableTime,
  toGalleryIndexRow
} from '@/lib/database/sql/galleryMedia'
import { toMediaRowId } from '@/lib/database/sql/media'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  chunkArray,
  getInsertBatchSize,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import {
  type GalleryAudience,
  isOwnerGalleryAudience
} from '@/lib/services/gallery/galleryAudience'
import { toSubjectKey } from '@/lib/services/gallery/galleryEntities'
import {
  DEFAULT_GALLERY_ALBUM_SORT,
  GALLERY_ALBUM_SORTS,
  GALLERY_ALBUM_VISIBILITIES,
  GalleryAlbum,
  GalleryAlbumSort,
  GalleryAlbumVisibility,
  MAX_GALLERY_ALBUM_ITEMS,
  SQLGalleryAlbum
} from '@/lib/types/database/galleryAlbums'

// Albums: owner-curated groups of the owner's own gallery media. An album item
// says nothing about who may see the photo. Every read of items goes through
// `buildGalleryMediaScope` with a REQUIRED `GalleryAudience`, the one place
// that decides what "visible gallery media" means, so an album never shows a
// photo outside the viewer's gallery scope, and every count, date range, cover
// and preview below is computed from the VISIBLE items only.
//
// Ordering and paging happen over one narrow read of the album's visible items
// (at most `MAX_GALLERY_ALBUM_ITEMS` rows of a handful of columns), not in SQL:
// the sort key `COALESCE(takenAt, createdAt)` and a cursor on it are timestamp
// comparisons whose stored form differs between SQLite (numbers or text) and
// PostgreSQL, and a JS sort over epoch milliseconds is the same on both. The
// full rows of just one page are then read through `getGalleryMediaByIds`,
// which applies the scope a second time.

const ALBUMS = 'gallery_albums'
const ITEMS = 'gallery_album_items'

// Bindings a scoped query spends beyond its `whereIn` list, as in
// `galleryMedia.ts`: generous, so SQLite's 999-variable cap is never hit.
const RESERVED_BINDINGS = 64

// The columns the "places hidden" count reads: the subject (for the
// threatened-species rule) and the place.
const PLACE_INDEX_COLUMNS = [
  'id',
  'subjectName',
  'subjectScientificName',
  'subjectCategory',
  'subjectTaxonKey',
  'subjectIucnCategory',
  'subjectLookupStatus',
  'placeName',
  'placePrecision',
  'placeLatitude',
  'placeLongitude',
  'takenAt',
  'createdAt'
] as const

// How many cover candidates an album card shows: the cover and two more.
const PREVIEW_COUNT = 3

export type GalleryAlbumPatch = {
  title?: string
  // `null` clears it.
  description?: string | null
  visibility?: GalleryAlbumVisibility
  sortOrder?: GalleryAlbumSort
  // A media id of the album's own items; `null` clears the explicit cover.
  coverMediaId?: string | null
}

export interface CreateGalleryAlbumWithinLimitParams {
  actorId: string
  title: string
  description?: string | null
  visibility?: GalleryAlbumVisibility
  sortOrder?: GalleryAlbumSort
  // The most albums the actor may hold; at or past it nothing is inserted.
  limit: number
  // The first photos, added in the same transaction as the album: either both
  // are written or neither is, so a failed add never leaves an empty album.
  mediaIds?: string[]
  // The most items an album may hold, for `mediaIds`.
  itemLimit?: number
}

export type CreateGalleryAlbumWithinLimitResult =
  | {
      status: 'created'
      album: GalleryAlbum
      // What became of `mediaIds`, as `addGalleryAlbumItems` reports it (all
      // empty without `mediaIds`).
      added: string[]
      existing: string[]
      skipped: string[]
    }
  | { status: 'limit-reached' }

export interface GetGalleryAlbumParams {
  id: string
  // The album's owner. An album of anyone else reads as missing.
  actorId: string
  audience: GalleryAudience
}

export interface GetGalleryAlbumSummariesParams {
  actorId: string
  audience: GalleryAudience
  // Only this album.
  albumId?: string
}

export interface UpdateGalleryAlbumParams extends GalleryAlbumPatch {
  id: string
  actorId: string
}

export type UpdateGalleryAlbumResult =
  | { status: 'updated'; album: GalleryAlbum }
  | { status: 'not-found' }
  // The cover is not one of the album's items.
  | { status: 'invalid-cover' }

export interface DeleteGalleryAlbumParams {
  id: string
  actorId: string
}

export interface AddGalleryAlbumItemsParams {
  albumId: string
  actorId: string
  mediaIds: string[]
  // The most items the album may hold; a request that would pass it adds
  // nothing at all.
  limit: number
}

export type AddGalleryAlbumItemsResult =
  | {
      status: 'added'
      // Newly added.
      added: string[]
      // Already in the album: left as they are.
      existing: string[]
      // Not the actor's own gallery media (foreign, missing, unposted or not in
      // the gallery): ignored.
      skipped: string[]
    }
  | { status: 'not-found' }
  | { status: 'limit-reached' }

export interface RemoveGalleryAlbumItemsParams {
  albumId: string
  actorId: string
  mediaIds: string[]
}

export type RemoveGalleryAlbumItemsResult =
  { status: 'removed'; removed: string[] } | { status: 'not-found' }

/** An album with what the audience can see of it. */
export interface GalleryAlbumSummary {
  album: GalleryAlbum
  // Visible items only.
  itemCount: number
  // The earliest and latest capture dates (upload date when there is none) of
  // the visible items, epoch milliseconds; null with no visible item.
  firstAt: number | null
  lastAt: number | null
  // The explicit cover when the audience can see it, else the newest visible
  // item; null with no visible item. Never a hidden item.
  coverMediaId: string | null
  // Up to three visible media ids for a card's collage, `coverMediaId` first.
  previewMediaIds: string[]
}

/** One visible item of an album, with what its facts and filters are read from. */
export interface GalleryAlbumIndexRow extends GalleryIndexRow {
  // Epoch milliseconds the media joined the album.
  addedAt: number
}

/** A position in an album's order: the sort key and the media id. */
export interface GalleryAlbumCursor {
  key: number
  mediaId: number
}

export interface GetGalleryAlbumMediaParams {
  albumId: string
  actorId: string
  audience: GalleryAudience
  sort: GalleryAlbumSort
  // Rows strictly after this position in `sort` order.
  after?: GalleryAlbumCursor
  // Callers ask for one more than a page to learn whether there is more.
  limit: number
  // A `toSubjectKey` key; only that species.
  subjectKey?: string
}

export interface GalleryAlbumMediaRow extends GalleryMediaRow {
  // The value the row was ordered by (see `GalleryAlbumSort`).
  sortKey: number
}

export interface GetGalleryAlbumIndexParams {
  albumId: string
  actorId: string
  audience: GalleryAudience
  // Read the audience's rows even when the audience may not open the album
  // itself (a private album read as the public). For the owner's own preview of
  // what a visitor would see, once the caller has checked ownership; the
  // photos are still scoped to the audience.
  ignoreAlbumVisibility?: boolean
}

export interface GetGalleryAlbumPlaceIndexesParams {
  actorId: string
  audience: GalleryAudience
  // Only this album.
  albumId?: string
}

export interface CountGalleryAlbumMediaParams {
  actorId: string
  audience: GalleryAudience
}

export interface CountGalleryAlbumStoredItemsParams {
  albumId: string
  actorId: string
}

export interface GetAlbumsForMediaParams {
  mediaId: string
  actorId: string
  audience: GalleryAudience
}

export interface GalleryAlbumDatabase {
  // The album, the cap, the insert and the first photos are decided in one
  // transaction serialised on the actor row, so concurrent creates cannot
  // overshoot the cap and a failed add leaves no album behind.
  createGalleryAlbumWithinLimit(
    params: CreateGalleryAlbumWithinLimitParams
  ): Promise<CreateGalleryAlbumWithinLimitResult>
  // The owner sees any album of theirs. Anyone else sees only a `public` album
  // with at least one item visible to them; otherwise it reads as missing,
  // exactly like an id that does not exist.
  getGalleryAlbum(params: GetGalleryAlbumParams): Promise<GalleryAlbum | null>
  // The actor's albums, last updated first, with counts, dates, cover and
  // collage from visible items. Anyone but the owner gets only public albums
  // with something visible.
  getGalleryAlbumSummaries(
    params: GetGalleryAlbumSummariesParams
  ): Promise<GalleryAlbumSummary[]>
  updateGalleryAlbum(
    params: UpdateGalleryAlbumParams
  ): Promise<UpdateGalleryAlbumResult>
  // Removes the album and its items; the media stays. False for a missing or
  // foreign album.
  deleteGalleryAlbum(params: DeleteGalleryAlbumParams): Promise<boolean>
  // Atomic: all of it or nothing. Only the actor's own gallery media is added;
  // anything else is reported as skipped.
  addGalleryAlbumItems(
    params: AddGalleryAlbumItemsParams
  ): Promise<AddGalleryAlbumItemsResult>
  removeGalleryAlbumItems(
    params: RemoveGalleryAlbumItemsParams
  ): Promise<RemoveGalleryAlbumItemsResult>
  // A page of the album's visible media in `sort` order, each with the post it
  // is shown through. Empty for a missing album.
  getGalleryAlbumMedia(
    params: GetGalleryAlbumMediaParams
  ): Promise<GalleryAlbumMediaRow[]>
  // Every visible item of the album, unordered, for the facts line and the
  // species filter.
  getGalleryAlbumIndex(
    params: GetGalleryAlbumIndexParams
  ): Promise<GalleryAlbumIndexRow[]>
  // The visible items that carry a place, grouped by album, for the owner's
  // "places hidden" count on the album cards: one read for every album (or
  // just `albumId`), with only the subject and place columns. Albums the
  // audience may not open are left out; albums with nothing to report may be
  // too.
  getGalleryAlbumPlaceIndexes(
    params: GetGalleryAlbumPlaceIndexesParams
  ): Promise<{ albumId: string; rows: GalleryAlbumIndexRow[] }[]>
  // How many distinct media the audience can see across the actor's albums
  // (public albums only, for anyone but the owner). A photo in several albums
  // counts once.
  countGalleryAlbumMedia(params: CountGalleryAlbumMediaParams): Promise<number>
  // How many items the album holds against its item cap: every stored row
  // whose media still exists, whether or not the owner can see it any more (a
  // deleted post's photo still counts). 0 for a missing or foreign album. Owner
  // data: callers must only send it to the owner.
  countGalleryAlbumStoredItems(
    params: CountGalleryAlbumStoredItemsParams
  ): Promise<number>
  // The albums the media is in. Owner only: any other audience gets none.
  getAlbumsForMedia(
    params: GetAlbumsForMediaParams
  ): Promise<{ id: string; title: string }[]>
}

const parseVisibility = (value: string): GalleryAlbumVisibility =>
  // Fails closed: anything unknown reads as private.
  (GALLERY_ALBUM_VISIBILITIES as readonly string[]).includes(value)
    ? (value as GalleryAlbumVisibility)
    : 'private'

const parseSort = (value: string): GalleryAlbumSort =>
  (GALLERY_ALBUM_SORTS as readonly string[]).includes(value)
    ? (value as GalleryAlbumSort)
    : DEFAULT_GALLERY_ALBUM_SORT

const parseAlbum = (row: SQLGalleryAlbum): GalleryAlbum => ({
  id: row.id,
  actorId: row.actorId,
  title: row.title,
  description: row.description ?? null,
  coverMediaId:
    row.coverMediaId === null || row.coverMediaId === undefined
      ? null
      : String(row.coverMediaId),
  visibility: parseVisibility(row.visibility),
  sortOrder: parseSort(row.sortOrder),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

const toRowIds = (mediaIds: string[]): number[] => [
  ...new Set(
    mediaIds
      .map((id) => toMediaRowId(String(id)))
      .filter((id): id is number => id !== null)
  )
]

interface SortableItem {
  mediaId: number
  takenAt: number | null
  createdAt: number
  addedAt: number
}

/** What an item is ordered by in each mode (see `GalleryAlbumSort`). */
const getSortKey = (item: SortableItem, sort: GalleryAlbumSort): number =>
  sort === 'added_desc' ? item.addedAt : (item.takenAt ?? item.createdAt)

/**
 * Orders two positions in `sort` order: negative when `a` comes first. Ties on
 * the key break on the media id, in the same direction as the key, so a page
 * boundary is stable.
 */
const comparePositions = (
  a: GalleryAlbumCursor,
  b: GalleryAlbumCursor,
  sort: GalleryAlbumSort
): number => {
  const direction = sort === 'taken_asc' ? 1 : -1
  if (a.key !== b.key) return a.key < b.key ? -direction : direction
  if (a.mediaId === b.mediaId) return 0
  return a.mediaId < b.mediaId ? -direction : direction
}

const toPosition = (
  item: SortableItem,
  sort: GalleryAlbumSort
): GalleryAlbumCursor => ({
  key: getSortKey(item, sort),
  mediaId: item.mediaId
})

const compareItems = (
  a: SortableItem,
  b: SortableItem,
  sort: GalleryAlbumSort
): number => comparePositions(toPosition(a, sort), toPosition(b, sort), sort)

export const GalleryAlbumSQLDatabaseMixin = (
  database: Knex
): GalleryAlbumDatabase => {
  const galleryMedia = GalleryMediaSQLDatabaseMixin(database)

  const readAlbum = async (
    id: string,
    actorId: string,
    executor: Knex | Knex.Transaction = database
  ): Promise<GalleryAlbum | null> => {
    const row = await executor<SQLGalleryAlbum>(ALBUMS)
      .where('id', id)
      .where('actorId', actorId)
      .first()
    return row ? parseAlbum(row) : null
  }

  // The album, but only when the audience may open it at all: the owner's
  // always; anyone else's only when it is public.
  const readOpenableAlbum = async (
    id: string,
    actorId: string,
    audience: GalleryAudience
  ): Promise<GalleryAlbum | null> => {
    const album = await readAlbum(id, actorId)
    if (!album) return null
    if (isOwnerGalleryAudience(audience)) return album
    return album.visibility === 'public' ? album : null
  }

  /** The scoped join of album items to the media the audience may see. */
  const visibleItemsQuery = (
    albumIds: string[],
    actorId: string,
    audience: GalleryAudience
  ) => {
    const query = database(`${ITEMS} as album_items`)
      .innerJoin('medias', 'medias.id', 'album_items.mediaId')
      .whereIn('album_items.albumId', albumIds)
      .where('album_items.actorId', actorId)
    buildGalleryMediaScope(database, actorId, audience)(query)
    return query
  }

  interface VisibleItem extends SortableItem {
    albumId: string
  }

  const readVisibleItems = async (
    albumIds: string[],
    actorId: string,
    audience: GalleryAudience
  ): Promise<VisibleItem[]> => {
    const items: VisibleItem[] = []
    for (const chunk of chunkArray(
      albumIds,
      getWhereInBatchSize(database, RESERVED_BINDINGS)
    )) {
      const rows: Array<Record<string, unknown>> = await visibleItemsQuery(
        chunk,
        actorId,
        audience
      ).select(
        'album_items.albumId as albumId',
        'album_items.createdAt as addedAt',
        'medias.id as mediaId',
        'medias.takenAt as takenAt',
        'medias.createdAt as createdAt'
      )
      for (const row of rows) {
        items.push({
          albumId: String(row.albumId),
          mediaId: Number(row.mediaId),
          takenAt: parseNullableTime(row.takenAt),
          createdAt: parseNullableTime(row.createdAt) ?? 0,
          addedAt: parseNullableTime(row.addedAt) ?? 0
        })
      }
    }
    return items
  }

  const readIndex = async (
    albumId: string,
    actorId: string,
    audience: GalleryAudience,
    ignoreAlbumVisibility = false
  ): Promise<GalleryAlbumIndexRow[]> => {
    const album = ignoreAlbumVisibility
      ? await readAlbum(albumId, actorId)
      : await readOpenableAlbum(albumId, actorId, audience)
    if (!album) return []

    const rows: Array<Record<string, unknown>> = await visibleItemsQuery(
      [albumId],
      actorId,
      audience
    ).select(
      'album_items.createdAt as addedAt',
      ...GALLERY_INDEX_COLUMNS.map((column) => `medias.${column}`)
    )
    return rows.map((row) => ({
      ...toGalleryIndexRow(row),
      addedAt: parseNullableTime(row.addedAt) ?? 0
    }))
  }

  const summarize = (
    album: GalleryAlbum,
    items: VisibleItem[]
  ): GalleryAlbumSummary => {
    // Newest first, whatever the album's own sort: the cover fallback and the
    // collage are the newest photos.
    const newestFirst = [...items].sort((a, b) =>
      compareItems(a, b, 'taken_desc')
    )
    const keys = newestFirst.map((item) => getSortKey(item, 'taken_desc'))

    const explicit =
      album.coverMediaId === null
        ? null
        : (newestFirst.find(
            (item) => String(item.mediaId) === album.coverMediaId
          ) ?? null)
    const cover = explicit ?? newestFirst[0] ?? null
    const previews = [
      ...(cover ? [cover] : []),
      ...newestFirst.filter((item) => item !== cover)
    ].slice(0, PREVIEW_COUNT)

    return {
      album,
      itemCount: items.length,
      firstAt: keys.length > 0 ? keys[keys.length - 1] : null,
      lastAt: keys.length > 0 ? keys[0] : null,
      coverMediaId: cover ? String(cover.mediaId) : null,
      previewMediaIds: previews.map((item) => String(item.mediaId))
    }
  }

  const lockActor = lockGalleryAlbumActor

  // The rows that count against the item cap: every item whose media still
  // exists, visible to the owner or not. A row left behind by a media that is
  // gone (SQLite has no foreign keys) takes no room.
  const countStoredItems = async (
    albumId: string,
    executor: Knex | Knex.Transaction = database
  ): Promise<number> => {
    const row = await executor(`${ITEMS} as album_items`)
      .innerJoin('medias', 'medias.id', 'album_items.mediaId')
      .where('album_items.albumId', albumId)
      .count<{ total: number | string }[]>({ total: '*' })
      .first()
    return Number(row?.total ?? 0)
  }

  // Adds the actor's own gallery media to the album inside the caller's
  // transaction, which holds the actor lock. All or nothing against `limit`.
  const addItems = async (
    trx: Knex.Transaction,
    {
      albumId,
      actorId,
      mediaIds,
      limit
    }: { albumId: string; actorId: string; mediaIds: string[]; limit: number }
  ): Promise<AddGalleryAlbumItemsResult> => {
    const album = await readAlbum(albumId, actorId, trx)
    if (!album) return { status: 'not-found' }

    const requested = toRowIds(mediaIds)
    // Anything that is not a media id at all is skipped too.
    const invalid = [...new Set(mediaIds.map(String))].filter(
      (id) => toMediaRowId(id) === null
    )

    // Only the actor's own gallery media: the same scope the owner's gallery
    // reads through, so a foreign id, a missing one, an unposted upload and a
    // photo outside the gallery are all skipped.
    const usable = new Set<number>()
    for (const chunk of chunkArray(
      requested,
      getWhereInBatchSize(trx, RESERVED_BINDINGS)
    )) {
      const query = trx('medias').whereIn('medias.id', chunk)
      buildGalleryMediaScope(trx, actorId, { kind: 'owner' })(query)
      const rows: Array<{ id: number | string }> =
        await query.select('medias.id')
      for (const row of rows) usable.add(Number(row.id))
    }

    const present = new Set<number>()
    for (const chunk of chunkArray(
      [...usable],
      getWhereInBatchSize(trx, RESERVED_BINDINGS)
    )) {
      const rows: Array<{ mediaId: number | string }> = await trx(ITEMS)
        .where('albumId', albumId)
        .whereIn('mediaId', chunk)
        .select('mediaId')
      for (const row of rows) present.add(Number(row.mediaId))
    }

    const fresh = [...usable].filter((id) => !present.has(id))
    if ((await countStoredItems(albumId, trx)) + fresh.length > limit) {
      return { status: 'limit-reached' }
    }

    if (fresh.length > 0) {
      const currentTime = new Date()
      const rows = fresh.map((mediaId) => ({
        albumId,
        mediaId,
        actorId,
        createdAt: currentTime
      }))
      for (const chunk of chunkArray(rows, getInsertBatchSize(trx, rows[0]))) {
        await trx(ITEMS).insert(chunk)
      }
      await trx(ALBUMS).where('id', albumId).update({ updatedAt: currentTime })
    }

    return {
      status: 'added',
      added: fresh.map(String),
      existing: requested.filter((id) => present.has(id)).map(String),
      skipped: [
        ...requested.filter((id) => !usable.has(id)).map(String),
        ...invalid
      ]
    }
  }

  return {
    async createGalleryAlbumWithinLimit({
      actorId,
      title,
      description,
      visibility,
      sortOrder,
      limit,
      mediaIds,
      itemLimit
    }) {
      return database.transaction(
        async (trx): Promise<CreateGalleryAlbumWithinLimitResult> => {
          await lockActor(trx, actorId)

          const count = await trx(ALBUMS)
            .where('actorId', actorId)
            .count<{ total: number | string }[]>({ total: '*' })
            .first()
          if (Number(count?.total ?? 0) >= limit) {
            return { status: 'limit-reached' }
          }

          const currentTime = new Date()
          const row: SQLGalleryAlbum = {
            id: crypto.randomUUID(),
            actorId,
            title,
            description: description ?? null,
            coverMediaId: null,
            visibility: visibility ?? 'public',
            sortOrder: sortOrder ?? DEFAULT_GALLERY_ALBUM_SORT,
            createdAt: currentTime,
            updatedAt: currentTime
          }
          await trx(ALBUMS).insert(row)

          let added: string[] = []
          let existing: string[] = []
          let skipped: string[] = []
          if (mediaIds && mediaIds.length > 0) {
            const result = await addItems(trx, {
              albumId: row.id,
              actorId,
              mediaIds,
              limit: itemLimit ?? MAX_GALLERY_ALBUM_ITEMS
            })
            // A fresh album can only take the ids when they fit; anything
            // else rolls the album back with them.
            if (result.status !== 'added') {
              throw new Error(
                `Could not add the first photos to the new album: ${result.status}`
              )
            }
            ;({ added, existing, skipped } = result)
          }
          return {
            status: 'created',
            album: parseAlbum(row),
            added,
            existing,
            skipped
          }
        }
      )
    },

    async getGalleryAlbum({ id, actorId, audience }) {
      const album = await readOpenableAlbum(id, actorId, audience)
      if (!album) return null
      if (isOwnerGalleryAudience(audience)) return album

      // A visitor is shown an album only when something in it is visible to
      // them; an empty one is as good as missing.
      const visible = await visibleItemsQuery([album.id], actorId, audience)
        .select(database.raw('1'))
        .first()
      return visible ? album : null
    },

    async getGalleryAlbumSummaries({ actorId, audience, albumId }) {
      const query = database<SQLGalleryAlbum>(ALBUMS).where('actorId', actorId)
      if (albumId !== undefined) query.where('id', albumId)
      if (!isOwnerGalleryAudience(audience)) {
        query.where('visibility', 'public')
      }
      const rows = await query.orderBy('updatedAt', 'desc').orderBy('id', 'asc')
      const albums = rows.map(parseAlbum)
      if (albums.length === 0) return []

      const items = await readVisibleItems(
        albums.map((album) => album.id),
        actorId,
        audience
      )
      const byAlbum = new Map<string, VisibleItem[]>()
      for (const item of items) {
        const list = byAlbum.get(item.albumId)
        if (list) list.push(item)
        else byAlbum.set(item.albumId, [item])
      }

      const isOwner = isOwnerGalleryAudience(audience)
      return albums
        .map((album) => summarize(album, byAlbum.get(album.id) ?? []))
        .filter((summary) => isOwner || summary.itemCount > 0)
    },

    async updateGalleryAlbum({ id, actorId, ...patch }) {
      return database.transaction(
        async (trx): Promise<UpdateGalleryAlbumResult> => {
          // Under the actor lock, so the cover check below and a concurrent
          // remove cannot interleave; the album is read after taking it.
          await lockActor(trx, actorId)
          const album = await readAlbum(id, actorId, trx)
          if (!album) return { status: 'not-found' }

          const update: Record<string, unknown> = {}
          if (patch.title !== undefined) update.title = patch.title
          if (patch.description !== undefined) {
            update.description = patch.description
          }
          if (patch.visibility !== undefined) {
            update.visibility = patch.visibility
          }
          if (patch.sortOrder !== undefined) update.sortOrder = patch.sortOrder
          if (patch.coverMediaId !== undefined) {
            if (patch.coverMediaId === null) {
              update.coverMediaId = null
            } else {
              const rowId = toMediaRowId(patch.coverMediaId)
              const item =
                rowId === null
                  ? null
                  : await trx(ITEMS)
                      .where('albumId', id)
                      .where('mediaId', rowId)
                      .first('mediaId')
              if (rowId === null || !item) return { status: 'invalid-cover' }
              update.coverMediaId = rowId
            }
          }

          await trx(ALBUMS)
            .where('id', id)
            .where('actorId', actorId)
            .update({ ...update, updatedAt: new Date() })

          const updated = await readAlbum(id, actorId, trx)
          return updated
            ? { status: 'updated', album: updated }
            : { status: 'not-found' }
        }
      )
    },

    async deleteGalleryAlbum({ id, actorId }) {
      return database.transaction(async (trx) => {
        await lockActor(trx, actorId)
        const album = await readAlbum(id, actorId, trx)
        if (!album) return false
        // The items go with the album (SQLite has no foreign keys to do it);
        // the media and its posts stay.
        await trx(ITEMS).where('albumId', id).del()
        const deleted = await trx(ALBUMS)
          .where('id', id)
          .where('actorId', actorId)
          .del()
        return deleted > 0
      })
    },

    async addGalleryAlbumItems({ albumId, actorId, mediaIds, limit }) {
      return database.transaction(
        async (trx): Promise<AddGalleryAlbumItemsResult> => {
          await lockActor(trx, actorId)
          return addItems(trx, { albumId, actorId, mediaIds, limit })
        }
      )
    },

    async removeGalleryAlbumItems({ albumId, actorId, mediaIds }) {
      return database.transaction(
        async (trx): Promise<RemoveGalleryAlbumItemsResult> => {
          // Under the actor lock, and the album (with its cover) is read after
          // taking it, so a cover set a moment ago is seen here.
          await lockActor(trx, actorId)
          const album = await readAlbum(albumId, actorId, trx)
          if (!album) return { status: 'not-found' }

          const requested = toRowIds(mediaIds)
          const removed: number[] = []
          for (const chunk of chunkArray(
            requested,
            getWhereInBatchSize(trx, RESERVED_BINDINGS)
          )) {
            const rows: Array<{ mediaId: number | string }> = await trx(ITEMS)
              .where('albumId', albumId)
              .whereIn('mediaId', chunk)
              .select('mediaId')
            if (rows.length === 0) continue
            await trx(ITEMS)
              .where('albumId', albumId)
              .whereIn('mediaId', chunk)
              .del()
            removed.push(...rows.map((row) => Number(row.mediaId)))
          }

          if (removed.length > 0) {
            // A cover must be an item: removing it clears the choice.
            const patch: Record<string, unknown> = { updatedAt: new Date() }
            if (
              album.coverMediaId !== null &&
              removed.includes(Number(album.coverMediaId))
            ) {
              patch.coverMediaId = null
            }
            await trx(ALBUMS).where('id', albumId).update(patch)
          }
          return { status: 'removed', removed: removed.map(String) }
        }
      )
    },

    async getGalleryAlbumMedia({
      albumId,
      actorId,
      audience,
      sort,
      after,
      limit,
      subjectKey
    }) {
      const size = normalizeLimit(limit)
      if (size === 0) return []
      const rows = await readIndex(albumId, actorId, audience)
      const sortable = rows
        .filter(
          (row) =>
            subjectKey === undefined ||
            toSubjectKey({
              name: row.subjectName,
              scientificName: row.subjectScientificName
            }) === subjectKey
        )
        .map((row): SortableItem => ({
          mediaId: Number(row.id),
          takenAt: row.takenAt,
          createdAt: row.createdAt,
          addedAt: row.addedAt
        }))
        .sort((a, b) => compareItems(a, b, sort))

      const page = (
        after
          ? sortable.filter(
              (item) =>
                comparePositions(toPosition(item, sort), after, sort) > 0
            )
          : sortable
      ).slice(0, size)
      if (page.length === 0) return []

      const full = await galleryMedia.getGalleryMediaByIds({
        actorId,
        audience,
        mediaIds: page.map((item) => String(item.mediaId))
      })
      const byId = new Map(full.map((row) => [row.media.id, row]))
      // A media whose last visible post went away since the index read drops
      // out rather than being shown bare.
      return page.flatMap((item): GalleryAlbumMediaRow[] => {
        const row = byId.get(String(item.mediaId))
        return row ? [{ ...row, sortKey: getSortKey(item, sort) }] : []
      })
    },

    getGalleryAlbumIndex({
      albumId,
      actorId,
      audience,
      ignoreAlbumVisibility
    }) {
      return readIndex(albumId, actorId, audience, ignoreAlbumVisibility)
    },

    async getGalleryAlbumPlaceIndexes({ actorId, audience, albumId }) {
      const albumQuery = database<SQLGalleryAlbum>(ALBUMS)
        .where('actorId', actorId)
        .select('id')
      if (albumId !== undefined) albumQuery.where('id', albumId)
      if (!isOwnerGalleryAudience(audience)) {
        albumQuery.where('visibility', 'public')
      }
      const albumIds = (await albumQuery).map((row) => row.id)

      const groups = new Map<string, GalleryAlbumIndexRow[]>()
      for (const chunk of chunkArray(
        albumIds,
        getWhereInBatchSize(database, RESERVED_BINDINGS)
      )) {
        const rows: Array<Record<string, unknown>> = await visibleItemsQuery(
          chunk,
          actorId,
          audience
        )
          .where((place) =>
            place
              .whereNotNull('medias.placeName')
              .orWhereNotNull('medias.placeLatitude')
          )
          .select(
            'album_items.albumId as albumId',
            ...PLACE_INDEX_COLUMNS.map((column) => `medias.${column}`)
          )
        for (const row of rows) {
          const key = String(row.albumId)
          const list = groups.get(key) ?? []
          list.push({ ...toGalleryIndexRow(row), addedAt: 0 })
          groups.set(key, list)
        }
      }
      return [...groups].map(([id, rows]) => ({ albumId: id, rows }))
    },

    async countGalleryAlbumMedia({ actorId, audience }) {
      const query = database(`${ITEMS} as album_items`)
        .innerJoin(`${ALBUMS} as albums`, 'albums.id', 'album_items.albumId')
        .innerJoin('medias', 'medias.id', 'album_items.mediaId')
        .where('albums.actorId', actorId)
        .where('album_items.actorId', actorId)
      if (!isOwnerGalleryAudience(audience)) {
        query.where('albums.visibility', 'public')
      }
      buildGalleryMediaScope(database, actorId, audience)(query)
      const row = await query
        .countDistinct<{ total: number | string }[]>({ total: 'medias.id' })
        .first()
      return Number(row?.total ?? 0)
    },

    async countGalleryAlbumStoredItems({ albumId, actorId }) {
      const album = await readAlbum(albumId, actorId)
      return album ? countStoredItems(album.id) : 0
    },

    async getAlbumsForMedia({ mediaId, actorId, audience }) {
      if (!isOwnerGalleryAudience(audience)) return []
      const rowId = toMediaRowId(mediaId)
      if (rowId === null) return []

      const rows: Array<{ id: string; title: string }> = await database(
        `${ITEMS} as album_items`
      )
        .innerJoin(`${ALBUMS} as albums`, 'albums.id', 'album_items.albumId')
        .where('album_items.mediaId', rowId)
        .where('album_items.actorId', actorId)
        .where('albums.actorId', actorId)
        .orderBy('albums.updatedAt', 'desc')
        .orderBy('albums.id', 'asc')
        .select('albums.id as id', 'albums.title as title')
      return rows.map((row) => ({ id: row.id, title: row.title }))
    }
  }
}
