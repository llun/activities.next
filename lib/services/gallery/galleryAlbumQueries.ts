import type {
  GalleryAlbumCursor,
  GalleryAlbumIndexRow,
  GalleryAlbumSummary
} from '@/lib/database/sql/galleryAlbums'
import { Database } from '@/lib/database/types'
import {
  GalleryAlbumCardEntity,
  GalleryAlbumDetailResponse,
  GalleryAlbumEntity,
  GalleryAlbumFacts,
  GalleryAlbumListResponse,
  GalleryAlbumMediaPage,
  GalleryAlbumSpeciesChip
} from '@/lib/services/gallery/galleryAlbumEntities'
import {
  type GalleryAudience,
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE,
  isOwnerGalleryAudience
} from '@/lib/services/gallery/galleryAudience'
import {
  GalleryItemEntity,
  toSubjectKey
} from '@/lib/services/gallery/galleryEntities'
import { projectRows } from '@/lib/services/gallery/galleryQueries'
import {
  countryDisplayName,
  getPublicPlace
} from '@/lib/services/gallery/publicMediaDetails'
import { isPlaceWithheldForThreat } from '@/lib/services/gallery/threatenedSpecies'
import { GallerySettings } from '@/lib/types/database/gallery'
import {
  GalleryAlbum,
  GalleryAlbumSort
} from '@/lib/types/database/galleryAlbums'

// The album read services, shared by the owner pages and the album routes
// (and, later, the visitor side). Each loads the owner's settings once, reads
// rows through the scoped `GalleryAlbumDatabase` methods (which go through
// `buildGalleryMediaScope` with the audience), resolves gear names in one batch
// and projects through `galleryProjection.ts`: nothing here decides what a
// viewer may see of a photo or its place.

type AlbumQueryDatabase = Pick<
  Database,
  | 'getGallerySettings'
  | 'getGalleryGearNamesByIds'
  | 'getGalleryMediaByIds'
  | 'getGalleryAlbum'
  | 'getGalleryAlbumSummaries'
  | 'getGalleryAlbumMedia'
  | 'getGalleryAlbumIndex'
  | 'getGalleryAlbumPlaceIndexes'
  | 'countGalleryAlbumMedia'
  | 'countGalleryAlbumStoredItems'
>

interface AlbumQueryBase {
  database: AlbumQueryDatabase
  // The gallery's owner: a local actor.
  owner: { id: string }
  audience: GalleryAudience
}

// The most species an album page offers as filter chips.
const MAX_SPECIES_CHIPS = 100

const toIso = (time: number | null): string | null =>
  time === null || !Number.isFinite(time) ? null : new Date(time).toISOString()

/** The cursor a client sends back as `max_id`. */
export const toAlbumCursorString = (cursor: GalleryAlbumCursor): string =>
  `${cursor.key}:${cursor.mediaId}`

/** `null` for anything `toAlbumCursorString` did not produce. */
export const parseAlbumCursor = (value: string): GalleryAlbumCursor | null => {
  const match = /^(-?\d{1,16}):(\d{1,10})$/.exec(value)
  if (!match) return null
  const key = Number(match[1])
  const mediaId = Number(match[2])
  return Number.isSafeInteger(key) && Number.isSafeInteger(mediaId)
    ? { key, mediaId }
    : null
}

export const toGalleryAlbumEntity = (
  album: GalleryAlbum
): GalleryAlbumEntity => ({
  id: album.id,
  title: album.title,
  description: album.description,
  visibility: album.visibility,
  sortOrder: album.sortOrder,
  createdAt: album.createdAt,
  updatedAt: album.updatedAt
})

const toCard = (
  summary: GalleryAlbumSummary,
  items: Map<string, GalleryItemEntity>,
  viewerIsOwner: boolean,
  hiddenPlaceCount: number
): GalleryAlbumCardEntity => {
  const previews = summary.previewMediaIds.flatMap((id) => {
    const item = items.get(id)
    return item ? [item] : []
  })
  return {
    ...toGalleryAlbumEntity(summary.album),
    itemCount: summary.itemCount,
    firstAt: toIso(summary.firstAt),
    lastAt: toIso(summary.lastAt),
    cover:
      summary.coverMediaId === null
        ? null
        : (items.get(summary.coverMediaId) ?? null),
    previews,
    coverMediaId: viewerIsOwner ? summary.album.coverMediaId : null,
    hiddenPlaceCount: viewerIsOwner ? hiddenPlaceCount : 0
  }
}

/**
 * How many places each album's photos leave out for a visitor, for the owner
 * only: nothing is read for anyone else, so a visitor's response never carries
 * a hint that a threatened species' place exists.
 */
const getHiddenPlaceCounts = async (
  database: AlbumQueryDatabase,
  owner: { id: string },
  audience: GalleryAudience,
  settings: GallerySettings,
  albumId?: string
): Promise<Map<string, number>> => {
  if (!isOwnerGalleryAudience(audience)) return new Map()
  const groups = await database.getGalleryAlbumPlaceIndexes({
    actorId: owner.id,
    audience,
    albumId
  })
  return new Map(
    groups.map(({ albumId: id, rows }) => [
      id,
      countHiddenThreatenedPlaces(rows, settings)
    ])
  )
}

/** Projects the media behind a set of summaries (covers and collages). */
const projectPreviews = async (
  database: AlbumQueryDatabase,
  owner: { id: string },
  audience: GalleryAudience,
  summaries: GalleryAlbumSummary[],
  settings: GallerySettings
): Promise<Map<string, GalleryItemEntity>> => {
  const mediaIds = [
    ...new Set(summaries.flatMap((summary) => summary.previewMediaIds))
  ]
  if (mediaIds.length === 0) return new Map()
  const rows = await database.getGalleryMediaByIds({
    actorId: owner.id,
    audience,
    mediaIds
  })
  return projectRows(database, rows, audience, settings)
}

/** One album as a card, for what `audience` can see of it. Null when missing. */
export const getGalleryAlbumCard = async ({
  database,
  owner,
  audience,
  albumId
}: AlbumQueryBase & {
  albumId: string
}): Promise<GalleryAlbumCardEntity | null> => {
  const [summary] = await database.getGalleryAlbumSummaries({
    actorId: owner.id,
    audience,
    albumId
  })
  if (!summary) return null
  const settings = await database.getGallerySettings({ actorId: owner.id })
  const [items, hidden] = await Promise.all([
    projectPreviews(database, owner, audience, [summary], settings),
    getHiddenPlaceCounts(database, owner, audience, settings, albumId)
  ])
  return toCard(
    summary,
    items,
    isOwnerGalleryAudience(audience),
    hidden.get(summary.album.id) ?? 0
  )
}

/** The actor's albums, last updated first. */
export const getGalleryAlbumList = async ({
  database,
  owner,
  audience
}: AlbumQueryBase): Promise<GalleryAlbumListResponse> => {
  const [summaries, photoCount, settings] = await Promise.all([
    database.getGalleryAlbumSummaries({ actorId: owner.id, audience }),
    database.countGalleryAlbumMedia({ actorId: owner.id, audience }),
    database.getGallerySettings({ actorId: owner.id })
  ])
  const [items, hidden] = await Promise.all([
    projectPreviews(database, owner, audience, summaries, settings),
    getHiddenPlaceCounts(database, owner, audience, settings)
  ])
  const isOwner = isOwnerGalleryAudience(audience)
  return {
    albums: summaries.map((summary) =>
      toCard(summary, items, isOwner, hidden.get(summary.album.id) ?? 0)
    ),
    photoCount
  }
}

export interface GetGalleryAlbumPageParams extends AlbumQueryBase {
  albumId: string
  sort: GalleryAlbumSort
  // The cursor of the last item of the previous page.
  maxId?: string
  limit: number
  // A `toSubjectKey` key.
  subjectKey?: string
}

/**
 * A page of the album's visible photos in `sort` order. Null when the album is
 * missing (or not the audience's to open); a bad cursor is an empty page.
 */
export const getGalleryAlbumPage = async ({
  database,
  owner,
  audience,
  albumId,
  sort,
  maxId,
  limit,
  subjectKey
}: GetGalleryAlbumPageParams): Promise<GalleryAlbumMediaPage | null> => {
  const album = await database.getGalleryAlbum({
    id: albumId,
    actorId: owner.id,
    audience
  })
  if (!album) return null

  const empty: GalleryAlbumMediaPage = { items: [], nextMaxId: null }
  let after: GalleryAlbumCursor | undefined
  if (maxId !== undefined) {
    const parsed = parseAlbumCursor(maxId)
    if (!parsed) return empty
    after = parsed
  }

  const pageSize = Math.max(1, Math.floor(limit))
  const [rows, settings] = await Promise.all([
    database.getGalleryAlbumMedia({
      albumId,
      actorId: owner.id,
      audience,
      sort,
      after,
      limit: pageSize + 1,
      subjectKey
    }),
    database.getGallerySettings({ actorId: owner.id })
  ])
  const hasMore = rows.length > pageSize
  const pageRows = rows.slice(0, pageSize)
  const items = await projectRows(database, pageRows, audience, settings)
  const last = pageRows[pageRows.length - 1]

  return {
    items: pageRows.flatMap((row) => {
      const item = items.get(row.media.id)
      return item ? [item] : []
    }),
    nextMaxId:
      hasMore && last
        ? toAlbumCursorString({
            key: last.sortKey,
            mediaId: Number(last.media.id)
          })
        : null
  }
}

const toPlaceKey = (
  place: NonNullable<ReturnType<typeof getPublicPlace>>
): string | null => {
  if (place.latitude !== undefined && place.longitude !== undefined) {
    return `${place.latitude.toFixed(4)},${place.longitude.toFixed(4)}`
  }
  const name = place.name?.trim().toLocaleLowerCase('en-US')
  return name ? `name:${name}` : null
}

/**
 * The facts line, from the rows `audience` can see. Every place-derived number
 * comes from `getPublicPlace`, so a place the public projection withholds (a
 * threatened species, a hidden location, a `hidden` precision) adds neither a
 * place nor a country. Pass the logged-out audience to get what a visitor sees.
 */
export const computeGalleryAlbumFacts = (
  rows: GalleryAlbumIndexRow[],
  settings: Pick<GallerySettings, 'hiddenLocations' | 'hideThreatenedPlaces'>
): GalleryAlbumFacts => {
  const species = new Set<string>()
  const places = new Set<string>()
  const countries = new Set<string>()
  const days = new Set<string>()
  let first: number | null = null
  let last: number | null = null

  for (const row of rows) {
    const key = toSubjectKey({
      name: row.subjectName,
      scientificName: row.subjectScientificName
    })
    if (key) species.add(key)

    const place = getPublicPlace(row, settings)
    if (place) {
      const placeKey = toPlaceKey(place)
      if (placeKey) places.add(placeKey)
      if (place.countryCode) countries.add(place.countryCode)
    }

    const at = row.takenAt ?? row.createdAt
    if (Number.isFinite(at)) {
      days.add(new Date(at).toISOString().slice(0, 10))
      if (first === null || at < first) first = at
      if (last === null || at > last) last = at
    }
  }

  return {
    photoCount: rows.length,
    speciesCount: species.size,
    placeCount: places.size,
    countryCount: countries.size,
    dayCount: days.size,
    countryCodes: [...countries].sort(),
    countryName:
      countries.size === 1 ? countryDisplayName([...countries][0]) : null,
    firstAt: toIso(first),
    lastAt: toIso(last)
  }
}

/**
 * How many distinct places the owner's own rows have that the public view
 * leaves out because the photo is of a threatened species (or its check has not
 * finished). Counted per place, not per photo, and only for a place that was
 * actually stored.
 */
export const countHiddenThreatenedPlaces = (
  rows: GalleryAlbumIndexRow[],
  settings: Pick<GallerySettings, 'hideThreatenedPlaces'>
): number => {
  const hidden = new Set<string>()
  for (const row of rows) {
    if (row.placePrecision === 'hidden') continue
    const hasPlace =
      row.placeName !== null ||
      (row.placeLatitude !== null && row.placeLongitude !== null)
    if (!hasPlace) continue
    if (!isPlaceWithheldForThreat(row, settings)) continue
    hidden.add(
      row.placeLatitude !== null && row.placeLongitude !== null
        ? `${row.placeLatitude.toFixed(2)},${row.placeLongitude.toFixed(2)}`
        : `name:${(row.placeName ?? '').trim().toLocaleLowerCase('en-US')}`
    )
  }
  return hidden.size
}

/** The species of the rows, most photos first (then by name). */
export const toSpeciesChips = (
  rows: GalleryAlbumIndexRow[]
): GalleryAlbumSpeciesChip[] => {
  const species = new Map<string, GalleryAlbumSpeciesChip>()
  // Newest first, so the newest photo's spelling names the species.
  const sorted = [...rows].sort(
    (a, b) => (b.takenAt ?? b.createdAt) - (a.takenAt ?? a.createdAt)
  )
  for (const row of sorted) {
    const key = toSubjectKey({
      name: row.subjectName,
      scientificName: row.subjectScientificName
    })
    if (!key) continue
    const current = species.get(key)
    if (current) {
      current.count += 1
    } else {
      species.set(key, {
        key,
        name: row.subjectName ?? row.subjectScientificName ?? key,
        count: 1
      })
    }
  }
  return [...species.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en'))
    .slice(0, MAX_SPECIES_CHIPS)
}

/**
 * The owner's album page: the album, its facts as a visitor would see them,
 * the owner's species chips, and the first page of photos. Null when missing.
 */
export const getGalleryAlbumDetail = async ({
  database,
  owner,
  albumId,
  limit,
  sort
}: {
  database: AlbumQueryDatabase
  owner: { id: string }
  albumId: string
  limit: number
  // Defaults to the album's own order.
  sort?: GalleryAlbumSort
}): Promise<GalleryAlbumDetailResponse | null> => {
  const card = await getGalleryAlbumCard({
    database,
    owner,
    audience: OWNER_GALLERY_AUDIENCE,
    albumId
  })
  if (!card) return null

  const [settings, ownerRows, publicRows, page, storedItemCount] =
    await Promise.all([
      database.getGallerySettings({ actorId: owner.id }),
      database.getGalleryAlbumIndex({
        albumId,
        actorId: owner.id,
        audience: OWNER_GALLERY_AUDIENCE
      }),
      database.getGalleryAlbumIndex({
        albumId,
        actorId: owner.id,
        audience: PUBLIC_GALLERY_AUDIENCE,
        // The route has already checked the album is the owner's. A private
        // album is not open to a visitor, but its owner is still shown what its
        // public-safe numbers would be.
        ignoreAlbumVisibility: true
      }),
      getGalleryAlbumPage({
        database,
        owner,
        audience: OWNER_GALLERY_AUDIENCE,
        albumId,
        sort: sort ?? card.sortOrder,
        limit
      }),
      database.countGalleryAlbumStoredItems({ albumId, actorId: owner.id })
    ])

  return {
    album: card,
    facts: computeGalleryAlbumFacts(publicRows, settings),
    hiddenPlaceCount: countHiddenThreatenedPlaces(ownerRows, settings),
    species: toSpeciesChips(ownerRows),
    mediaIds: ownerRows.map((row) => row.id),
    storedItemCount,
    page: page ?? { items: [], nextMaxId: null }
  }
}
