import crypto from 'crypto'
import { type Updateable, sql } from 'kysely'

import { getGalleryMediaByIds } from '@/lib/database/domains/gallery/media'
import {
  GALLERY_INDEX_COLUMNS,
  normalizeLimit,
  parseNullableTime,
  toGalleryIndexRow
} from '@/lib/database/domains/gallery/rows'
import type {
  AddGalleryAlbumItemsParams,
  AddGalleryAlbumItemsResult,
  CountGalleryAlbumMediaParams,
  CountGalleryAlbumStoredItemsParams,
  CreateGalleryAlbumWithinLimitParams,
  CreateGalleryAlbumWithinLimitResult,
  DeleteGalleryAlbumParams,
  GalleryAlbumCursor,
  GalleryAlbumIndexRow,
  GalleryAlbumMediaRow,
  GalleryAlbumSummary,
  GetAlbumsForMediaParams,
  GetGalleryAlbumIndexParams,
  GetGalleryAlbumMediaParams,
  GetGalleryAlbumParams,
  GetGalleryAlbumPlaceIndexesParams,
  GetGalleryAlbumSummariesParams,
  HasVisibleGalleryAlbumsParams,
  RemoveGalleryAlbumItemsParams,
  RemoveGalleryAlbumItemsResult,
  UpdateGalleryAlbumParams,
  UpdateGalleryAlbumResult
} from '@/lib/database/domains/gallery/types'
import { lockGalleryAlbumActor } from '@/lib/database/domains/media/galleryAlbumCleanup'
import { toMediaRowId } from '@/lib/database/domains/media/rows'
import { type Db, inTransaction } from '@/lib/database/kysely'
import type { GalleryAlbums } from '@/lib/database/kysely/db'
import {
  getWhereInBatchSize,
  insertInChunks
} from '@/lib/database/kysely/inList'
import { galleryMediaScope } from '@/lib/database/kysely/visibility/galleryMedia'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray } from '@/lib/database/sql/utils/knex'
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
// `galleryMediaScope` (lib/database/kysely/visibility/galleryMedia.ts) with a
// REQUIRED `GalleryAudience`, which decides what "visible gallery media" means
// for every other gallery read, so an album never shows a
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

// Bindings a scoped query spends beyond its `in` list, as in ./media.ts:
// generous, so SQLite's 999-variable cap is never hit.
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

// On the root instance or, inside a write, on that write's transaction.
const readAlbum = async (
  db: Db,
  id: string,
  actorId: string
): Promise<GalleryAlbum | null> => {
  const row = await db
    .selectFrom('gallery_albums')
    .selectAll()
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  return row ? parseAlbum(row) : null
}

// The album, but only when the audience may open it at all: the owner's
// always; anyone else's only when it is public.
const readOpenableAlbum = async (
  db: Db,
  id: string,
  actorId: string,
  audience: GalleryAudience
): Promise<GalleryAlbum | null> => {
  const album = await readAlbum(db, id, actorId)
  if (!album) return null
  if (isOwnerGalleryAudience(audience)) return album
  return album.visibility === 'public' ? album : null
}

/** The scoped join of album items to the media the audience may see. */
const visibleItemsQuery = (
  db: Db,
  albumIds: string[],
  actorId: string,
  audience: GalleryAudience
) =>
  db
    .selectFrom('gallery_album_items as album_items')
    .innerJoin('medias', 'medias.id', 'album_items.mediaId')
    .where('album_items.albumId', 'in', albumIds)
    .where('album_items.actorId', '=', actorId)
    .where(galleryMediaScope(db, actorId, audience))

interface VisibleItem extends SortableItem {
  albumId: string
}

const readVisibleItems = async (
  db: Db,
  albumIds: string[],
  actorId: string,
  audience: GalleryAudience
): Promise<VisibleItem[]> => {
  const items: VisibleItem[] = []
  for (const chunk of chunkArray(
    albumIds,
    getWhereInBatchSize(db, RESERVED_BINDINGS)
  )) {
    const rows = await visibleItemsQuery(db, chunk, actorId, audience)
      .select([
        'album_items.albumId as albumId',
        'album_items.createdAt as addedAt',
        'medias.id as mediaId',
        'medias.takenAt as takenAt',
        'medias.createdAt as createdAt'
      ])
      .execute()
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
  db: Db,
  albumId: string,
  actorId: string,
  audience: GalleryAudience,
  ignoreAlbumVisibility = false
): Promise<GalleryAlbumIndexRow[]> => {
  const album = ignoreAlbumVisibility
    ? await readAlbum(db, albumId, actorId)
    : await readOpenableAlbum(db, albumId, actorId, audience)
  if (!album) return []

  const rows = await visibleItemsQuery(db, [albumId], actorId, audience)
    .select([
      'album_items.createdAt as addedAt',
      ...GALLERY_INDEX_COLUMNS.map((column) => `medias.${column}` as const)
    ])
    .execute()
  return rows.map((row) => ({
    ...toGalleryIndexRow(row),
    addedAt: parseNullableTime(row.addedAt) ?? 0
  }))
}

const summarize = (
  storedAlbum: GalleryAlbum,
  items: VisibleItem[],
  isOwner: boolean
): GalleryAlbumSummary => {
  // The album's own `createdAt` and `updatedAt` move whenever its photos
  // change, whatever the photo's visibility, so a visitor would see the owner
  // add or remove a photo they cannot see. A visitor's album carries times
  // computed from the photos they can see instead: when the first and the
  // latest of those joined the album.
  const album: GalleryAlbum = isOwner
    ? storedAlbum
    : {
        ...storedAlbum,
        createdAt: items.reduce(
          (min, item) => Math.min(min, item.addedAt),
          items[0]?.addedAt ?? 0
        ),
        updatedAt: items.reduce(
          (max, item) => Math.max(max, item.addedAt),
          items[0]?.addedAt ?? 0
        )
      }
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

// The rows that count against the item cap: every item whose media still
// exists, visible to the owner or not. A row left behind by a media that is
// gone (SQLite has no foreign keys) takes no room.
const countStoredItems = async (db: Db, albumId: string): Promise<number> => {
  const row = await db
    .selectFrom('gallery_album_items as album_items')
    .innerJoin('medias', 'medias.id', 'album_items.mediaId')
    .where('album_items.albumId', '=', albumId)
    .select((eb) => eb.fn.countAll().as('total'))
    .limit(1)
    .executeTakeFirst()
  return Number(row?.total ?? 0)
}

// Adds the actor's own gallery media to the album inside the caller's
// transaction, which holds the actor lock. All or nothing against `limit`.
const addItems = async (
  trx: Db,
  {
    albumId,
    actorId,
    mediaIds,
    limit
  }: { albumId: string; actorId: string; mediaIds: string[]; limit: number }
): Promise<AddGalleryAlbumItemsResult> => {
  const album = await readAlbum(trx, albumId, actorId)
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
    const rows = await trx
      .selectFrom('medias')
      .select('medias.id')
      .where('medias.id', 'in', chunk)
      .where(galleryMediaScope(trx, actorId, { kind: 'owner' }))
      .execute()
    for (const row of rows) usable.add(Number(row.id))
  }

  const present = new Set<number>()
  for (const chunk of chunkArray(
    [...usable],
    getWhereInBatchSize(trx, RESERVED_BINDINGS)
  )) {
    const rows = await trx
      .selectFrom('gallery_album_items')
      .select('mediaId')
      .where('albumId', '=', albumId)
      .where('mediaId', 'in', chunk)
      .execute()
    for (const row of rows) present.add(Number(row.mediaId))
  }

  const fresh = [...usable].filter((id) => !present.has(id))
  if ((await countStoredItems(trx, albumId)) + fresh.length > limit) {
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
    await insertInChunks(trx, rows, (chunk) =>
      trx.insertInto('gallery_album_items').values(chunk).execute()
    )
    await trx
      .updateTable('gallery_albums')
      .set({ updatedAt: currentTime })
      .where('id', '=', albumId)
      .execute()
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

export const createGalleryAlbumWithinLimit = (
  db: Db,
  {
    actorId,
    title,
    description,
    visibility,
    sortOrder,
    limit,
    mediaIds,
    itemLimit
  }: CreateGalleryAlbumWithinLimitParams
): Promise<CreateGalleryAlbumWithinLimitResult> =>
  inTransaction(
    db,
    async (trx): Promise<CreateGalleryAlbumWithinLimitResult> => {
      await lockGalleryAlbumActor(trx, actorId)

      const count = await trx
        .selectFrom('gallery_albums')
        .select((eb) => eb.fn.countAll().as('total'))
        .where('actorId', '=', actorId)
        .limit(1)
        .executeTakeFirst()
      if (Number(count?.total ?? 0) >= limit) {
        return { status: 'limit-reached' }
      }

      const currentTime = new Date()
      const row = {
        id: crypto.randomUUID(),
        actorId,
        title,
        description: description ?? null,
        coverMediaId: null,
        visibility: visibility ?? 'public',
        sortOrder: sortOrder ?? DEFAULT_GALLERY_ALBUM_SORT,
        createdAt: currentTime,
        updatedAt: currentTime
      } satisfies SQLGalleryAlbum
      await trx.insertInto('gallery_albums').values(row).execute()

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

export const getGalleryAlbum = async (
  db: Db,
  { id, actorId, audience }: GetGalleryAlbumParams
): Promise<GalleryAlbum | null> => {
  const album = await readOpenableAlbum(db, id, actorId, audience)
  if (!album) return null
  if (isOwnerGalleryAudience(audience)) return album

  // A visitor is shown an album only when something in it is visible to
  // them; an empty one is as good as missing.
  const visible = await visibleItemsQuery(db, [album.id], actorId, audience)
    .select(sql.lit(1).as('one'))
    .limit(1)
    .executeTakeFirst()
  return visible ? album : null
}

export const getGalleryAlbumSummaries = async (
  db: Db,
  { actorId, audience, albumId }: GetGalleryAlbumSummariesParams
): Promise<GalleryAlbumSummary[]> => {
  const rows = await db
    .selectFrom('gallery_albums')
    .selectAll()
    .where('actorId', '=', actorId)
    .$if(albumId !== undefined, (qb) => qb.where('id', '=', albumId!))
    .$if(!isOwnerGalleryAudience(audience), (qb) =>
      qb.where('visibility', '=', 'public')
    )
    .orderBy('updatedAt', 'desc')
    .orderBy('id', 'asc')
    .execute()
  const albums = rows.map(parseAlbum)
  if (albums.length === 0) return []

  const items = await readVisibleItems(
    db,
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
  const summaries = albums
    .map((album) => summarize(album, byAlbum.get(album.id) ?? [], isOwner))
    .filter((summary) => isOwner || summary.itemCount > 0)
  // The owner's order is by the stored `updatedAt` (already applied);
  // a visitor's by the visible-only one, so the order moves only with
  // what they can see.
  return isOwner
    ? summaries
    : summaries.sort(
        (a, b) =>
          b.album.updatedAt - a.album.updatedAt ||
          (a.album.id < b.album.id ? -1 : a.album.id > b.album.id ? 1 : 0)
      )
}

export const updateGalleryAlbum = (
  db: Db,
  { id, actorId, ...patch }: UpdateGalleryAlbumParams
): Promise<UpdateGalleryAlbumResult> =>
  inTransaction(db, async (trx): Promise<UpdateGalleryAlbumResult> => {
    // Under the actor lock, so the cover check below and a concurrent
    // remove cannot interleave; the album is read after taking it.
    await lockGalleryAlbumActor(trx, actorId)
    const album = await readAlbum(trx, id, actorId)
    if (!album) return { status: 'not-found' }

    const update: Updateable<GalleryAlbums> = {}
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
            : await trx
                .selectFrom('gallery_album_items')
                .select('mediaId')
                .where('albumId', '=', id)
                .where('mediaId', '=', rowId)
                .limit(1)
                .executeTakeFirst()
        if (rowId === null || !item) return { status: 'invalid-cover' }
        update.coverMediaId = rowId
      }
    }

    await trx
      .updateTable('gallery_albums')
      .set({ ...update, updatedAt: new Date() })
      .where('id', '=', id)
      .where('actorId', '=', actorId)
      .execute()

    const updated = await readAlbum(trx, id, actorId)
    return updated
      ? { status: 'updated', album: updated }
      : { status: 'not-found' }
  })

export const deleteGalleryAlbum = (
  db: Db,
  { id, actorId }: DeleteGalleryAlbumParams
): Promise<boolean> =>
  inTransaction(db, async (trx) => {
    await lockGalleryAlbumActor(trx, actorId)
    const album = await readAlbum(trx, id, actorId)
    if (!album) return false
    // The items go with the album (SQLite has no foreign keys to do it);
    // the media and its posts stay.
    await trx
      .deleteFrom('gallery_album_items')
      .where('albumId', '=', id)
      .execute()
    const deleted = await trx
      .deleteFrom('gallery_albums')
      .where('id', '=', id)
      .where('actorId', '=', actorId)
      .executeTakeFirst()
    return Number(deleted.numDeletedRows) > 0
  })

export const addGalleryAlbumItems = (
  db: Db,
  { albumId, actorId, mediaIds, limit }: AddGalleryAlbumItemsParams
): Promise<AddGalleryAlbumItemsResult> =>
  inTransaction(db, async (trx): Promise<AddGalleryAlbumItemsResult> => {
    await lockGalleryAlbumActor(trx, actorId)
    return addItems(trx, { albumId, actorId, mediaIds, limit })
  })

export const removeGalleryAlbumItems = (
  db: Db,
  { albumId, actorId, mediaIds }: RemoveGalleryAlbumItemsParams
): Promise<RemoveGalleryAlbumItemsResult> =>
  inTransaction(db, async (trx): Promise<RemoveGalleryAlbumItemsResult> => {
    // Under the actor lock, and the album (with its cover) is read after
    // taking it, so a cover set a moment ago is seen here.
    await lockGalleryAlbumActor(trx, actorId)
    const album = await readAlbum(trx, albumId, actorId)
    if (!album) return { status: 'not-found' }

    const requested = toRowIds(mediaIds)
    const removed: number[] = []
    for (const chunk of chunkArray(
      requested,
      getWhereInBatchSize(trx, RESERVED_BINDINGS)
    )) {
      const rows = await trx
        .selectFrom('gallery_album_items')
        .select('mediaId')
        .where('albumId', '=', albumId)
        .where('mediaId', 'in', chunk)
        .execute()
      if (rows.length === 0) continue
      await trx
        .deleteFrom('gallery_album_items')
        .where('albumId', '=', albumId)
        .where('mediaId', 'in', chunk)
        .execute()
      removed.push(...rows.map((row) => Number(row.mediaId)))
    }

    if (removed.length > 0) {
      // A cover must be an item: removing it clears the choice.
      const patch: Updateable<GalleryAlbums> = { updatedAt: new Date() }
      if (
        album.coverMediaId !== null &&
        removed.includes(Number(album.coverMediaId))
      ) {
        patch.coverMediaId = null
      }
      await trx
        .updateTable('gallery_albums')
        .set(patch)
        .where('id', '=', albumId)
        .execute()
    }
    return { status: 'removed', removed: removed.map(String) }
  })

export const getGalleryAlbumMedia = async (
  db: Db,
  {
    albumId,
    actorId,
    audience,
    sort,
    after,
    limit,
    subjectKey
  }: GetGalleryAlbumMediaParams
): Promise<GalleryAlbumMediaRow[]> => {
  const size = normalizeLimit(limit)
  if (size === 0) return []
  const rows = await readIndex(db, albumId, actorId, audience)
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
          (item) => comparePositions(toPosition(item, sort), after, sort) > 0
        )
      : sortable
  ).slice(0, size)
  if (page.length === 0) return []

  const full = await getGalleryMediaByIds(db, {
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
}

export const getGalleryAlbumIndex = (
  db: Db,
  {
    albumId,
    actorId,
    audience,
    ignoreAlbumVisibility
  }: GetGalleryAlbumIndexParams
): Promise<GalleryAlbumIndexRow[]> =>
  readIndex(db, albumId, actorId, audience, ignoreAlbumVisibility)

export const getGalleryAlbumPlaceIndexes = async (
  db: Db,
  { actorId, audience, albumId }: GetGalleryAlbumPlaceIndexesParams
): Promise<{ albumId: string; rows: GalleryAlbumIndexRow[] }[]> => {
  const albumIds = (
    await db
      .selectFrom('gallery_albums')
      .select('id')
      .where('actorId', '=', actorId)
      .$if(albumId !== undefined, (qb) => qb.where('id', '=', albumId!))
      .$if(!isOwnerGalleryAudience(audience), (qb) =>
        qb.where('visibility', '=', 'public')
      )
      .execute()
  ).map((row) => row.id)

  const groups = new Map<string, GalleryAlbumIndexRow[]>()
  for (const chunk of chunkArray(
    albumIds,
    getWhereInBatchSize(db, RESERVED_BINDINGS)
  )) {
    const rows = await visibleItemsQuery(db, chunk, actorId, audience)
      .where((eb) =>
        eb.or([
          eb('medias.placeName', 'is not', null),
          eb('medias.placeLatitude', 'is not', null)
        ])
      )
      .select([
        'album_items.albumId as albumId',
        ...PLACE_INDEX_COLUMNS.map((column) => `medias.${column}` as const)
      ])
      .execute()
    for (const row of rows) {
      const key = String(row.albumId)
      const list = groups.get(key) ?? []
      list.push({ ...toGalleryIndexRow(row), addedAt: 0 })
      groups.set(key, list)
    }
  }
  return [...groups].map(([id, rows]) => ({ albumId: id, rows }))
}

export const countGalleryAlbumMedia = async (
  db: Db,
  { actorId, audience }: CountGalleryAlbumMediaParams
): Promise<number> => {
  const row = await db
    .selectFrom('gallery_album_items as album_items')
    .innerJoin('gallery_albums as albums', 'albums.id', 'album_items.albumId')
    .innerJoin('medias', 'medias.id', 'album_items.mediaId')
    .where('albums.actorId', '=', actorId)
    .where('album_items.actorId', '=', actorId)
    .$if(!isOwnerGalleryAudience(audience), (qb) =>
      qb.where('albums.visibility', '=', 'public')
    )
    .where(galleryMediaScope(db, actorId, audience))
    .select((eb) => eb.fn.count('medias.id').distinct().as('total'))
    .limit(1)
    .executeTakeFirst()
  return Number(row?.total ?? 0)
}

export const getActorHasVisibleGalleryAlbums = async (
  db: Db,
  { actorId, audience }: HasVisibleGalleryAlbumsParams
): Promise<boolean> => {
  if (isOwnerGalleryAudience(audience)) {
    const own = await db
      .selectFrom('gallery_albums')
      .select('id')
      .where('actorId', '=', actorId)
      .limit(1)
      .executeTakeFirst()
    return Boolean(own)
  }
  const row = await db
    .selectFrom('gallery_album_items as album_items')
    .innerJoin('gallery_albums as albums', 'albums.id', 'album_items.albumId')
    .innerJoin('medias', 'medias.id', 'album_items.mediaId')
    .where('albums.actorId', '=', actorId)
    .where('album_items.actorId', '=', actorId)
    .where('albums.visibility', '=', 'public')
    .where(galleryMediaScope(db, actorId, audience))
    .select(sql.lit(1).as('one'))
    .limit(1)
    .executeTakeFirst()
  return Boolean(row)
}

export const countGalleryAlbumStoredItems = async (
  db: Db,
  { albumId, actorId }: CountGalleryAlbumStoredItemsParams
): Promise<number> => {
  const album = await readAlbum(db, albumId, actorId)
  return album ? countStoredItems(db, album.id) : 0
}

export const getAlbumsForMedia = async (
  db: Db,
  { mediaId, actorId, audience }: GetAlbumsForMediaParams
): Promise<{ id: string; title: string }[]> => {
  if (!isOwnerGalleryAudience(audience)) return []
  const rowId = toMediaRowId(mediaId)
  if (rowId === null) return []

  const rows = await db
    .selectFrom('gallery_album_items as album_items')
    .innerJoin('gallery_albums as albums', 'albums.id', 'album_items.albumId')
    .where('album_items.mediaId', '=', rowId)
    .where('album_items.actorId', '=', actorId)
    .where('albums.actorId', '=', actorId)
    .orderBy('albums.updatedAt', 'desc')
    .orderBy('albums.id', 'asc')
    .select(['albums.id as id', 'albums.title as title'])
    .execute()
  return rows.map((row) => ({ id: row.id, title: row.title }))
}

// The facade getSQLDatabase binds with bindDb().
export const galleryAlbumQueries = {
  createGalleryAlbumWithinLimit,
  getGalleryAlbum,
  getGalleryAlbumSummaries,
  updateGalleryAlbum,
  deleteGalleryAlbum,
  addGalleryAlbumItems,
  removeGalleryAlbumItems,
  getGalleryAlbumMedia,
  getGalleryAlbumIndex,
  getGalleryAlbumPlaceIndexes,
  countGalleryAlbumMedia,
  getActorHasVisibleGalleryAlbums,
  countGalleryAlbumStoredItems,
  getAlbumsForMedia
}
