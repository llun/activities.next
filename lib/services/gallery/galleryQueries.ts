import type {
  GalleryDayStatsRows,
  GalleryIndexRow,
  GalleryMediaCursor,
  GalleryMediaFilters,
  GalleryMediaRow
} from '@/lib/database/domains/gallery/types'
import { toMediaRowId } from '@/lib/database/domains/media/rows'
import { Database } from '@/lib/database/types'
import {
  parseAlbumCursor,
  toAlbumCursorString
} from '@/lib/services/gallery/galleryAlbumQueries'
import {
  type GalleryAudience,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import {
  GalleryDayKey,
  GalleryDayStats,
  GalleryItemEntity,
  GalleryLifeListEntry,
  GalleryLifeListResponse,
  GalleryMapResponse,
  GalleryMediaIdsResponse,
  GalleryMediaPage,
  GallerySubjectEntry,
  GallerySubjectGroupCategory,
  GallerySubjectsResponse,
  toGalleryDayKey,
  toPlaceKey,
  toSubjectKey,
  toUtcDay
} from '@/lib/services/gallery/galleryEntities'
import {
  GalleryPlaceSettings,
  GalleryProjectionViewer,
  getGalleryGearIdsToResolve,
  toGalleryItemEntity,
  toGalleryMapPoint,
  toGalleryProjectionViewer
} from '@/lib/services/gallery/galleryProjection'
import {
  getPublicPlace,
  toCountryCode
} from '@/lib/services/gallery/publicMediaDetails'
import {
  GALLERY_FILTER_NONE,
  GalleryMediaSort,
  GallerySettings,
  GalleryShow,
  MEDIA_SUBJECT_CATEGORIES,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'

// The gallery's read services, shared by the owner pages (which call them with
// `OWNER_GALLERY_AUDIENCE`) and the account-scoped API routes (which pass the
// requesting viewer's audience). Each loads the owner's settings once, reads
// rows through the scoped database methods, resolves gear names in one batch
// and projects through `galleryProjection.ts`.
//
// Subjects and the life list group in JS over one capped index read, keyed by
// `toSubjectKey`, so both backends agree on what one subject is. Past the cap,
// those responses say `truncated: true`.

export const GALLERY_INDEX_CAP = 5000
// Index windows (or short reads) one page request may scan before it answers
// with what it has and a cursor to continue from.
export const MAX_INDEX_WINDOWS = 3

type GalleryQueryDatabase = Pick<
  Database,
  | 'getGallerySettings'
  | 'getGalleryGearNamesByIds'
  | 'getGalleryMedia'
  | 'getGalleryMediaByIds'
  | 'getGalleryMediaIndex'
  | 'getGalleryMapRows'
  | 'getGalleryAlbumItemSets'
  | 'countGalleryMedia'
  | 'getGalleryDayStats'
  | 'getGalleryMediaIds'
>

interface GalleryQueryBase {
  database: GalleryQueryDatabase
  // The gallery's owner: a local actor.
  owner: { id: string }
  audience: GalleryAudience
}

export interface GetGalleryMediaPageParams extends GalleryQueryBase {
  maxId?: string
  limit: number
  subjectKey?: string
  category?: MediaSubjectCategory
  // Owner only. Anyone else asking gets an empty page; the routes answer 422
  // before it gets here.
  gearId?: string
  // Owner only: which posted media to list (default `in_gallery`, the
  // gallery). Ignored for every other audience, which only ever sees the
  // gallery.
  show?: GalleryShow
  sort?: GalleryMediaSort
  cursor?: string
  // Owner only: restrict the page to one GalleryDayKey.
  dayKey?: GalleryDayKey
  place?: string
  takenFrom?: string
  takenTo?: string
  activityId?: string
  albumId?: string
  includeTotal?: boolean
  // Owner only: ask for per-day stats (`days`) on each page.
  includeDays?: boolean
}

export const projectRows = async (
  database: Pick<GalleryQueryDatabase, 'getGalleryGearNamesByIds'>,
  rows: GalleryMediaRow[],
  audience: GalleryAudience,
  settings: GallerySettings
): Promise<Map<string, GalleryItemEntity>> => {
  const viewer = toGalleryProjectionViewer(audience)
  const gearIds = getGalleryGearIdsToResolve(rows, { viewer, settings })
  const gearNames =
    gearIds.length > 0
      ? await database.getGalleryGearNamesByIds({ ids: gearIds })
      : {}
  return new Map(
    rows.map((row) => [
      row.media.id,
      toGalleryItemEntity(row, { viewer, settings, gearNames })
    ])
  )
}

const normalizePageLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1

// 'YYYY-MM-DD' shifted by whole UTC days; null when unparsable.
const shiftUtcDay = (day: string, deltaDays: number): string | null => {
  const date = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + deltaDays)
  return toUtcDay(date.getTime())
}

// The query filters of a media page and of an `ids_only` read, built the same
// way: the shared filters pass through, the owner-only ones only for the
// owner.
const toGalleryMediaFilters = ({
  isOwner,
  subjectKey,
  category,
  place,
  takenFrom,
  takenTo,
  activityId
}: {
  isOwner: boolean
  subjectKey?: string
  category?: MediaSubjectCategory
  place?: string
  takenFrom?: string
  takenTo?: string
  activityId?: string
}): GalleryMediaFilters => {
  const placeKey = isOwner
    ? place === GALLERY_FILTER_NONE
      ? ''
      : place !== undefined
        ? toPlaceKey(place)
        : undefined
    : undefined

  const mappedActivityId = isOwner
    ? activityId === GALLERY_FILTER_NONE
      ? null
      : activityId !== undefined
        ? activityId
        : undefined
    : undefined

  return {
    ...(subjectKey !== undefined ? { subjectKey } : null),
    ...(category !== undefined ? { category } : null),
    ...(placeKey !== undefined ? { placeKey } : null),
    ...(isOwner && takenFrom !== undefined ? { takenFrom } : null),
    ...(isOwner && takenTo !== undefined ? { takenTo } : null),
    ...(mappedActivityId !== undefined
      ? { activityId: mappedActivityId }
      : null)
  }
}

// The day stats rows of the days a page spans, reduced to the `days` map: one
// entry per GalleryDayKey with the day's full count, its in-album count, its
// most common place and its busiest countable activity. Every tie is broken
// by a stable comparison (never row order), so SQLite and PostgreSQL — whose
// grouped rows may arrive in different orders — reduce to the same `days`.
export const reduceGalleryDayStats = (
  stats: GalleryDayStatsRows,
  sort: GalleryMediaSort,
  hasAlbum: boolean
): Record<GalleryDayKey, GalleryDayStats> => {
  const keyOf = (day: string, dateless: boolean): GalleryDayKey =>
    toGalleryDayKey(day, sort === 'uploaded' || dateless)

  interface PlaceEntry {
    total: number
    spellings: Map<string, number>
  }
  interface DayEntry {
    count: number
    inAlbum: number
    places: Map<string, PlaceEntry>
    activities: Map<
      string,
      {
        activityType: string | null
        distanceMeters: number | null
        count: number
        startTime: number | null
      }
    >
  }
  const days = new Map<GalleryDayKey, DayEntry>()
  const dayOf = (key: GalleryDayKey): DayEntry => {
    let entry = days.get(key)
    if (!entry) {
      entry = {
        count: 0,
        inAlbum: 0,
        places: new Map(),
        activities: new Map()
      }
      days.set(key, entry)
    }
    return entry
  }

  for (const row of stats.places) {
    const entry = dayOf(keyOf(row.day, row.dateless))
    entry.count += row.count
    if (hasAlbum && row.inAlbum !== null) entry.inAlbum += row.inAlbum
    if (row.placeName === null || toPlaceKey(row.placeName) === '') continue
    const placeKey = toPlaceKey(row.placeName)
    const place = entry.places.get(placeKey) ?? {
      total: 0,
      spellings: new Map<string, number>()
    }
    place.total += row.count
    place.spellings.set(
      row.placeName,
      (place.spellings.get(row.placeName) ?? 0) + row.count
    )
    entry.places.set(placeKey, place)
  }

  for (const row of stats.activities) {
    const entry = dayOf(keyOf(row.day, row.dateless))
    const activity = entry.activities.get(row.fitnessFileId) ?? {
      activityType: row.activityType,
      distanceMeters: row.totalDistanceMeters,
      count: 0,
      startTime: row.activityStartTime
    }
    activity.count += row.count
    if (
      row.activityStartTime !== null &&
      (activity.startTime === null ||
        row.activityStartTime < activity.startTime)
    ) {
      activity.startTime = row.activityStartTime
    }
    entry.activities.set(row.fitnessFileId, activity)
  }

  const result: Record<GalleryDayKey, GalleryDayStats> = {}
  for (const [key, entry] of days) {
    // The place key with the most photos (ties: the code-unit-first
    // normalised key), shown as its most-used raw spelling (ties: the
    // code-unit-first spelling).
    let bestPlaceKey: string | null = null
    let bestPlace: PlaceEntry | null = null
    let bestPlaceTotal = -1
    for (const [placeKey, place] of entry.places) {
      if (
        place.total > bestPlaceTotal ||
        (place.total === bestPlaceTotal &&
          (bestPlaceKey === null || placeKey < bestPlaceKey))
      ) {
        bestPlaceKey = placeKey
        bestPlaceTotal = place.total
        bestPlace = place
      }
    }
    let placeName: string | null = null
    if (bestPlace) {
      let bestSpelling: string | null = null
      let bestSpellingCount = -1
      for (const [spelling, count] of bestPlace.spellings) {
        if (
          count > bestSpellingCount ||
          (count === bestSpellingCount &&
            (bestSpelling === null || spelling < bestSpelling))
        ) {
          bestSpellingCount = count
          bestSpelling = spelling
        }
      }
      placeName = bestSpelling
    }

    // The activity with the most photos that day (ties: earliest start, then
    // id).
    const beats = (
      act: { count: number; startTime: number | null; id: string },
      best: { count: number; startTime: number | null; id: string }
    ): boolean => {
      if (act.count !== best.count) return act.count > best.count
      const actStart = act.startTime ?? Number.POSITIVE_INFINITY
      const bestStart = best.startTime ?? Number.POSITIVE_INFINITY
      if (actStart !== bestStart) return actStart < bestStart
      return act.id < best.id
    }
    let activity: GalleryDayStats['activity'] = null
    let best: { count: number; startTime: number | null; id: string } | null =
      null
    for (const [id, act] of entry.activities) {
      if (best && !beats({ ...act, id }, best)) continue
      best = { ...act, id }
      activity = {
        id,
        activityType: act.activityType,
        distanceMeters: act.distanceMeters
      }
    }

    result[key] = {
      count: entry.count,
      ...(hasAlbum ? { inAlbum: entry.inAlbum } : null),
      placeName,
      activity
    }
  }
  return result
}

export const getGalleryMediaPage = async ({
  database,
  owner,
  audience,
  maxId,
  limit,
  subjectKey,
  category,
  gearId,
  show: requestedShow,
  sort,
  cursor,
  dayKey,
  place,
  takenFrom,
  takenTo,
  activityId,
  albumId,
  includeTotal,
  includeDays
}: GetGalleryMediaPageParams): Promise<GalleryMediaPage> => {
  const empty: GalleryMediaPage = { items: [], nextMaxId: null }
  const pageSize = normalizePageLimit(limit)
  const viewer = toGalleryProjectionViewer(audience)
  const isOwner = viewer === 'owner'
  if (gearId !== undefined && !isOwner) return empty

  const show = isOwner ? requestedShow : undefined
  const effectiveSort: GalleryMediaSort = isOwner
    ? (sort ?? 'uploaded')
    : 'uploaded'
  const effectiveCursor = isOwner ? cursor : undefined
  const effectiveAlbumId = isOwner ? albumId : undefined
  const effectiveIncludeTotal = isOwner ? Boolean(includeTotal) : false

  const filters = toGalleryMediaFilters({
    isOwner,
    subjectKey,
    category,
    place,
    takenFrom,
    takenTo,
    activityId
  })

  const isDateSort =
    effectiveSort === 'taken_desc' || effectiveSort === 'taken_asc'

  let currentCursor: GalleryMediaCursor | undefined
  if (isDateSort) {
    if (effectiveCursor !== undefined) {
      const parsed = parseAlbumCursor(effectiveCursor)
      if (!parsed) return empty
      currentCursor = parsed
    }
  } else {
    if (maxId !== undefined && toMediaRowId(maxId) === null) return empty
  }

  const settings = await database.getGallerySettings({ actorId: owner.id })

  let currentMaxId: string | undefined = !isDateSort ? maxId : undefined
  let resumeAfterCursor: GalleryMediaCursor | null = null
  let resumeAfterMaxId: string | null = null
  const rows: GalleryMediaRow[] = []

  for (let reads = 0; reads < MAX_INDEX_WINDOWS; reads += 1) {
    const batch = await database.getGalleryMedia({
      actorId: owner.id,
      audience,
      sort: effectiveSort,
      cursor: isDateSort ? currentCursor : undefined,
      dayKey: isOwner ? dayKey : undefined,
      maxId: !isDateSort ? currentMaxId : undefined,
      limit: pageSize + 1 - rows.length,
      gearId,
      show,
      filters
    })
    if (batch.length === 0) break
    rows.push(...batch)
    if (rows.length > pageSize) break

    const last = batch[batch.length - 1]
    if (isDateSort) {
      // Date orders skip NULL sortAt rows; never page on a made-up key.
      if (last.sortAt == null) break
      currentCursor = {
        key: last.sortAt,
        mediaId: Number(last.media.id)
      }
    } else {
      currentMaxId = last.media.id
    }

    if (reads === MAX_INDEX_WINDOWS - 1) {
      if (isDateSort) {
        resumeAfterCursor = currentCursor ?? null
      } else {
        resumeAfterMaxId = currentMaxId ?? null
      }
    }
  }

  const hasMore = rows.length > pageSize
  const pageRows = rows.slice(0, pageSize)
  const items = await projectRows(database, pageRows, audience, settings)

  let counts: Map<string, number> | null = null
  if (isOwner && pageRows.length > 0) {
    const sets = await database.getGalleryAlbumItemSets({
      actorId: owner.id,
      mediaIds: pageRows.map((row) => row.media.id)
    })
    counts = new Map<string, number>()
    for (const set of sets) {
      for (const id of set.mediaIds) {
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
  }

  let nextMaxId: string | null
  let nextCursor: string | null | undefined

  if (isDateSort) {
    nextMaxId = null
    const lastRow = pageRows[pageRows.length - 1]
    if (hasMore) {
      nextCursor =
        lastRow.sortAt != null
          ? toAlbumCursorString({
              key: lastRow.sortAt,
              mediaId: Number(lastRow.media.id)
            })
          : null
    } else {
      nextCursor = resumeAfterCursor
        ? toAlbumCursorString(resumeAfterCursor)
        : null
    }
  } else {
    nextMaxId = hasMore
      ? pageRows[pageRows.length - 1].media.id
      : resumeAfterMaxId
  }

  let total: number | undefined
  let inAlbumTotal: number | undefined

  if (effectiveIncludeTotal) {
    const countResult = await database.countGalleryMedia({
      actorId: owner.id,
      audience,
      show,
      gearId,
      filters,
      albumId: effectiveAlbumId,
      sort: effectiveSort,
      // The same day bound the list applies, so a day-restricted page's
      // totals cover that day alone.
      dayKey: isOwner ? dayKey : undefined
    })
    total = countResult.total
    if (countResult.inAlbum !== null) {
      inAlbumTotal = countResult.inAlbum
    }
  }

  // Owner, `include_days=true`: full-day stats for the days this page spans
  // (a day spanning pages is answered twice with the same numbers; the client
  // merges by key).
  let days: Record<GalleryDayKey, GalleryDayStats> | undefined
  if (isOwner && includeDays && pageRows.length > 0) {
    // The page's day keys, by the rule the items are grouped with (see
    // `getGalleryDayKey`): dated photos by their camera day, dateless photos
    // — and every photo under sort=uploaded — by their upload day.
    const pageKeys = new Set(
      pageRows.flatMap((row) => {
        const item = items.get(row.media.id)
        if (!item) return []
        if (
          effectiveSort !== 'uploaded' &&
          item.takenAt !== null &&
          item.takenAt !== undefined
        ) {
          const day = toUtcDay(item.takenAt)
          if (day !== null) return [toGalleryDayKey(day, false)]
        }
        const uploadedDay = toUtcDay(item.uploadedAt ?? null)
        return uploadedDay !== null ? [toGalleryDayKey(uploadedDay, true)] : []
      })
    )
    const pageDays = pageRows
      .map((row) =>
        toUtcDay(effectiveSort === 'uploaded' ? row.uploadedAt : row.sortAt)
      )
      .filter((day): day is string => day !== null)
    if (pageDays.length > 0) {
      const fromDay = pageDays.reduce((a, b) => (b < a ? b : a))
      const toDay = pageDays.reduce((a, b) => (b > a ? b : a))
      const stats = await database.getGalleryDayStats({
        actorId: owner.id,
        audience,
        show,
        gearId,
        filters,
        sort: effectiveSort,
        // A dateless upload's sortAt is stamped up to a second before its
        // createdAt, so its upload day can sit one UTC day outside the
        // page's sortAt span; widen the bound by a day each side so the
        // read covers every day the page shows.
        fromDay: isDateSort ? (shiftUtcDay(fromDay, -1) ?? fromDay) : fromDay,
        toDay: isDateSort ? (shiftUtcDay(toDay, 1) ?? toDay) : toDay,
        ...(effectiveAlbumId !== undefined
          ? { albumId: effectiveAlbumId }
          : null)
      })
      const reduced = reduceGalleryDayStats(
        stats,
        effectiveSort,
        effectiveAlbumId !== undefined
      )
      // The widened bound also reads days the page does not show; keep only
      // the page's keys.
      days = Object.fromEntries(
        Object.entries(reduced).filter(([key]) => pageKeys.has(key))
      )
    }
  }

  return {
    items: pageRows.flatMap((row) => {
      const item = items.get(row.media.id)
      if (!item) return []
      if (counts) {
        return [{ ...item, albumCount: counts.get(item.mediaId) ?? 0 }]
      }
      return [item]
    }),
    nextMaxId,
    ...(nextCursor !== undefined ? { nextCursor } : null),
    ...(total !== undefined ? { total } : null),
    ...(inAlbumTotal !== undefined ? { inAlbumTotal } : null),
    ...(days ? { days } : null)
  }
}

export interface GetGalleryMediaIdsParams extends GalleryQueryBase {
  limit: number
  offset?: number
  subjectKey?: string
  category?: MediaSubjectCategory
  gearId?: string
  show?: GalleryShow
  sort?: GalleryMediaSort
  place?: string
  takenFrom?: string
  takenTo?: string
  activityId?: string
  // The GalleryDayKey of the day to read.
  dayKey: GalleryDayKey
  // Leave out photos this album of the owner already holds.
  excludeAlbumId?: string
}

// `ids_only`: one page of one day's matches in `sort` order, minus the album's
// members. Owner only; anyone else gets an empty list (the route answers 422).
export const getGalleryMediaIds = async ({
  database,
  owner,
  audience,
  limit,
  offset = 0,
  subjectKey,
  category,
  gearId,
  show,
  sort,
  place,
  takenFrom,
  takenTo,
  activityId,
  dayKey,
  excludeAlbumId
}: GetGalleryMediaIdsParams): Promise<GalleryMediaIdsResponse> => {
  const isOwner = toGalleryProjectionViewer(audience) === 'owner'
  if (!isOwner) return { mediaIds: [] }

  const filters = toGalleryMediaFilters({
    isOwner,
    subjectKey,
    category,
    place,
    takenFrom,
    takenTo,
    activityId
  })

  return {
    mediaIds: await database.getGalleryMediaIds({
      actorId: owner.id,
      audience,
      show,
      gearId,
      filters,
      sort: sort ?? 'uploaded',
      dayKey,
      limit,
      offset,
      ...(excludeAlbumId !== undefined ? { excludeAlbumId } : null)
    })
  }
}

interface SubjectGroup {
  key: string
  // Newest first.
  rows: GalleryIndexRow[]
}

const readIndex = async (
  database: GalleryQueryDatabase,
  ownerId: string,
  audience: GalleryAudience
): Promise<{ rows: GalleryIndexRow[]; truncated: boolean }> => {
  const rows = await database.getGalleryMediaIndex({
    actorId: ownerId,
    audience,
    limit: GALLERY_INDEX_CAP + 1
  })
  return {
    rows: rows.slice(0, GALLERY_INDEX_CAP),
    truncated: rows.length > GALLERY_INDEX_CAP
  }
}

const groupBySubject = (
  rows: GalleryIndexRow[]
): { groups: SubjectGroup[]; unidentifiedCount: number } => {
  const groups = new Map<string, SubjectGroup>()
  let unidentifiedCount = 0
  for (const row of rows) {
    const key = toSubjectKey({
      name: row.subjectName,
      scientificName: row.subjectScientificName
    })
    if (!key) {
      unidentifiedCount += 1
      continue
    }
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { key, rows: [row] })
  }
  return { groups: [...groups.values()], unidentifiedCount }
}

const firstNonNull = <T>(values: Array<T | null>): T | null =>
  values.find((value): value is T => value !== null) ?? null

interface ViewerPlace {
  name: string | null
  countryCode: string | null
}

/**
 * The place of an index row as the viewer is shown it: the stored one for the
 * owner, and `getPublicPlace` for everyone else. Every place-derived stat
 * (countries, the life list's "Where") is computed from this, so a place the
 * public projection withholds — a threatened species, a hidden location, a
 * `hidden` precision — contributes nothing a viewer could infer it from.
 */
type PlaceOf = (row: GalleryIndexRow) => ViewerPlace | null

const toPlaceOf = (
  viewer: GalleryProjectionViewer,
  settings: GalleryPlaceSettings
): PlaceOf => {
  const cache = new Map<string, ViewerPlace | null>()
  return (row) => {
    const cached = cache.get(row.id)
    if (cached !== undefined) return cached
    let place: ViewerPlace | null
    if (viewer === 'owner') {
      place =
        row.placeName === null && row.placeCountryCode === null
          ? null
          : {
              name: row.placeName,
              countryCode: toCountryCode(row.placeCountryCode)
            }
    } else {
      const projected = getPublicPlace(row, {
        hiddenLocations: settings.hiddenLocations,
        hideThreatenedPlaces: settings.hideThreatenedPlaces
      })
      place = projected
        ? { name: projected.name, countryCode: projected.countryCode }
        : null
    }
    cache.set(row.id, place)
    return place
  }
}

/** Country codes, most rows first (then by code); each row counts once. */
const toCountryCodes = (rows: GalleryIndexRow[], placeOf: PlaceOf) => {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const code = placeOf(row)?.countryCode
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([code]) => code)
}

/** Distinct countries, or null when none is known (the stat is omitted). */
export const toCountryCount = (codes: Iterable<string | null>) => {
  const distinct = new Set<string>()
  for (const code of codes) if (code) distinct.add(code)
  return distinct.size > 0 ? distinct.size : null
}

const toIso = (time: number | null): string | null =>
  time === null || !Number.isFinite(time) ? null : new Date(time).toISOString()

// Min and max are reduced here, over parsed times, never with SQL MIN/MAX over
// SQLite's mixed storage types.
const summarizeGroup = (
  group: SubjectGroup,
  placeOf: PlaceOf
): GalleryLifeListEntry => {
  let first: number | null = null
  let last: number | null = null
  let firstPlaceName: string | null = null
  let firstPlaceSeenAt: number | null = null
  for (const row of group.rows) {
    const seenAt = row.takenAt ?? row.createdAt
    if (!Number.isFinite(seenAt)) continue
    if (first === null || seenAt < first) first = seenAt
    if (last === null || seenAt > last) last = seenAt
    const placeName = placeOf(row)?.name ?? null
    // Rows are newest first, so `<=` lets an older row with the same time win.
    if (
      placeName !== null &&
      (firstPlaceSeenAt === null || seenAt <= firstPlaceSeenAt)
    ) {
      firstPlaceName = placeName
      firstPlaceSeenAt = seenAt
    }
  }
  return {
    key: group.key,
    // The newest photo's naming wins; older spellings fill gaps.
    name: firstNonNull(group.rows.map((row) => row.subjectName)),
    scientificName: firstNonNull(
      group.rows.map((row) => row.subjectScientificName)
    ),
    category: firstNonNull(group.rows.map((row) => row.subjectCategory)),
    taxonKey: firstNonNull(group.rows.map((row) => row.subjectTaxonKey)),
    taxonPath: firstNonNull(group.rows.map((row) => row.subjectTaxonPath)),
    countryCodes: toCountryCodes(group.rows, placeOf),
    count: group.rows.length,
    firstSeenAt: toIso(first),
    lastSeenAt: toIso(last),
    coverMediaId: group.rows[0].id,
    firstPlaceName
  }
}

export const getGallerySubjects = async ({
  database,
  owner,
  audience
}: GalleryQueryBase): Promise<GallerySubjectsResponse> => {
  const [settings, { rows, truncated }] = await Promise.all([
    database.getGallerySettings({ actorId: owner.id }),
    readIndex(database, owner.id, audience)
  ])
  const { groups, unidentifiedCount } = groupBySubject(rows)
  const placeOf = toPlaceOf(toGalleryProjectionViewer(audience), settings)
  const summaries = groups.map((group) => summarizeGroup(group, placeOf))

  const coverRows = await database.getGalleryMediaByIds({
    actorId: owner.id,
    audience,
    mediaIds: summaries.map((summary) => summary.coverMediaId)
  })
  const covers = await projectRows(database, coverRows, audience, settings)

  const byCategory = new Map<
    GallerySubjectGroupCategory,
    GallerySubjectEntry[]
  >()
  for (const {
    coverMediaId,
    firstPlaceName: _firstPlaceName,
    ...summary
  } of summaries) {
    const cover = covers.get(coverMediaId)
    // The cover's post went away between the two reads; so has the subject's
    // newest photo, and the next read will show it with its new cover.
    if (!cover) continue
    const category = summary.category ?? 'unidentified'
    const list = byCategory.get(category) ?? []
    list.push({ ...summary, cover })
    byCategory.set(category, list)
  }

  const order: GallerySubjectGroupCategory[] = [
    ...MEDIA_SUBJECT_CATEGORIES,
    'unidentified'
  ]
  return {
    groups: order.flatMap((category) => {
      const subjects = byCategory.get(category)
      if (!subjects || subjects.length === 0) return []
      subjects.sort((a, b) => Number(b.cover.mediaId) - Number(a.cover.mediaId))
      return [{ category, subjects }]
    }),
    unidentifiedCount,
    countryCount: toCountryCount(
      rows.map((row) => placeOf(row)?.countryCode ?? null)
    ),
    truncated
  }
}

export const getGalleryLifeList = async ({
  database,
  owner,
  audience
}: GalleryQueryBase): Promise<GalleryLifeListResponse> => {
  const [settings, { rows, truncated }] = await Promise.all([
    database.getGallerySettings({ actorId: owner.id }),
    readIndex(database, owner.id, audience)
  ])
  const { groups } = groupBySubject(rows)
  const placeOf = toPlaceOf(toGalleryProjectionViewer(audience), settings)

  // A landscape is not a species. A subject with no key never reaches here.
  const entries: GalleryLifeListEntry[] = groups
    .map((group) => summarizeGroup(group, placeOf))
    .filter((entry) => entry.category !== 'landscape')
    .sort((a, b) => {
      if (a.firstSeenAt !== b.firstSeenAt) {
        if (a.firstSeenAt === null) return 1
        if (b.firstSeenAt === null) return -1
        return a.firstSeenAt < b.firstSeenAt ? -1 : 1
      }
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
    })

  const byCategory: Partial<Record<MediaSubjectCategory, number>> = {}
  for (const entry of entries) {
    if (!entry.category) continue
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1
  }

  return { total: entries.length, byCategory, entries, truncated }
}

export const getGalleryMapPoints = async ({
  database,
  owner,
  audience
}: GalleryQueryBase): Promise<GalleryMapResponse> => {
  const [settings, rows] = await Promise.all([
    database.getGallerySettings({ actorId: owner.id }),
    database.getGalleryMapRows({
      actorId: owner.id,
      audience,
      limit: GALLERY_INDEX_CAP + 1
    })
  ])
  const viewer = toGalleryProjectionViewer(audience)

  // The owner's rows say what the public map does with each point, and only
  // the public query knows which media sit on a public post.
  const publicMediaIds =
    viewer === 'owner'
      ? new Set(
          (
            await database.getGalleryMapRows({
              actorId: owner.id,
              audience: PUBLIC_GALLERY_AUDIENCE,
              limit: GALLERY_INDEX_CAP + 1
            })
          ).map((row) => row.id)
        )
      : undefined

  const points = rows.slice(0, GALLERY_INDEX_CAP).flatMap((row) => {
    const point = toGalleryMapPoint(row, { viewer, settings, publicMediaIds })
    return point ? [point] : []
  })
  return {
    points,
    // From the points as projected, so a withheld point adds no country.
    countryCount: toCountryCount(points.map((point) => point.countryCode)),
    truncated: rows.length > GALLERY_INDEX_CAP
  }
}
