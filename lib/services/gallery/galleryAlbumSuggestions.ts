import type { GalleryIndexRow } from '@/lib/database/sql/galleryMedia'
import { Database } from '@/lib/database/types'
import {
  DateKey,
  addDays,
  localDateKeyAt,
  localDayWindow
} from '@/lib/fitness/calendar/localDay'
import { computeGalleryIndexFacts } from '@/lib/services/gallery/galleryAlbumQueries'
import {
  ACTIVITY_DAY_MIN_PHOTOS,
  GalleryAlbumSuggestionEntity,
  GalleryAlbumSuggestionKind,
  GalleryAlbumSuggestionMediaResponse,
  GalleryAlbumSuggestionsResponse,
  MAX_SUGGESTIONS_PER_KIND,
  MAX_SUGGESTION_MEDIA_IDS,
  SPECIES_MIN_PHOTOS,
  TRIP_MAX_GAP_DAYS,
  TRIP_MIN_PHOTOS
} from '@/lib/services/gallery/galleryAlbumSuggestionEntities'
import {
  clusterTrips,
  compareNewestFirst,
  dayKeyToMs,
  getRowTime,
  groupPhotosByDay,
  groupSpecies,
  isCoveredByOneAlbum,
  toLocalDayKey
} from '@/lib/services/gallery/galleryAlbumSuggestionGroups'
import {
  getActivityDayTitle,
  getSpeciesTitle,
  getTripTitle
} from '@/lib/services/gallery/galleryAlbumSuggestionTitles'
import {
  GalleryAudience,
  OWNER_GALLERY_AUDIENCE,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import {
  GALLERY_INDEX_CAP,
  MAX_INDEX_WINDOWS,
  projectRows
} from '@/lib/services/gallery/galleryQueries'
import { GallerySettings } from '@/lib/types/database/gallery'

// Album suggestions: groups of the owner's own gallery photos that probably
// belong in one album. They are computed on demand from the owner's gallery
// scope (in the gallery, on a post of theirs that still exists) and never
// stored, so a suggestion is exactly as fresh as the request.
//
// - Trip: photos with a capture date, split where two neighbouring local days
//   are more than `TRIP_MAX_GAP_DAYS` apart.
// - Species series: a species with at least `SPECIES_MIN_PHOTOS` photos.
// - Activity day: a day on which the owner recorded a fitness activity and took
//   at least `ACTIVITY_DAY_MIN_PHOTOS` photos.
//
// A suggestion that one existing album already covers is left out, so it does
// not keep coming back once used. Titles and counts are public-safe: see
// `galleryAlbumSuggestionTitles.ts`.

type SuggestionDatabase = Pick<
  Database,
  | 'getGallerySettings'
  | 'getGalleryGearNamesByIds'
  | 'getGalleryMediaIndex'
  | 'getGalleryMediaByIds'
  | 'getGalleryAlbumItemSets'
  | 'getFitnessActivitiesInWindow'
>

// Activities are looked up for the newest photo days only, in windows of this
// many local days (the oldest photo day of a window is at most this far from
// its newest), and for at most this many windows a request. An activity-day
// suggestion is only ever one of the newest, so older photo days are not worth a
// query; an owner with photos on many days still costs a bounded number of
// reads.
const ACTIVITY_WINDOW_SPAN_DAYS = 31
const MAX_ACTIVITY_WINDOWS = 12
// The page size `getFitnessActivitiesInWindow` allows, and how many pages one
// window reads: 1,000 activities in 31 days is far beyond any real account.
const ACTIVITY_PAGE_SIZE = 100
const MAX_ACTIVITY_PAGES_PER_WINDOW = 10

interface Candidate {
  id: string
  kind: GalleryAlbumSuggestionKind
  title: string
  // Newest first.
  rows: GalleryIndexRow[]
  activityCount: number
}

/**
 * The gallery as the light index for an audience, newest upload first, read in
 * windows moved by a cursor (the way the subject pages read it) up to a bound.
 * A gallery past the bound is suggested from its newest photos.
 */
const readIndex = async (
  database: Pick<SuggestionDatabase, 'getGalleryMediaIndex'>,
  ownerId: string,
  audience: GalleryAudience
): Promise<GalleryIndexRow[]> => {
  const rows: GalleryIndexRow[] = []
  let cursor: string | undefined
  for (let windows = 0; windows < MAX_INDEX_WINDOWS; windows += 1) {
    const window = await database.getGalleryMediaIndex({
      actorId: ownerId,
      audience,
      limit: GALLERY_INDEX_CAP,
      ...(cursor === undefined ? null : { maxId: cursor })
    })
    rows.push(...window)
    if (window.length < GALLERY_INDEX_CAP) break
    cursor = window[window.length - 1].id
  }
  return rows
}

/**
 * How many recorded activities fall on each local day (in `timeZone`) of one
 * window of local days, a page at a time. Reads the same countable activities
 * the fitness overview does.
 */
const readActivityWindow = async (
  database: Pick<SuggestionDatabase, 'getFitnessActivitiesInWindow'>,
  ownerId: string,
  timeZone: string,
  firstDay: DateKey,
  lastDay: DateKey
): Promise<Map<string, number>> => {
  const { startMs, endMs } = localDayWindow(firstDay, lastDay, timeZone)
  const days = new Map<string, number>()
  for (let page = 0; page < MAX_ACTIVITY_PAGES_PER_WINDOW; page += 1) {
    const { activities, hasMore } = await database.getFitnessActivitiesInWindow(
      {
        actorId: ownerId,
        startDate: startMs,
        endDate: endMs,
        limit: ACTIVITY_PAGE_SIZE,
        offset: page * ACTIVITY_PAGE_SIZE
      }
    )
    for (const activity of activities) {
      if (!Number.isFinite(activity.startTime)) continue
      const key = localDateKeyAt(activity.startTime, timeZone)
      days.set(key, (days.get(key) ?? 0) + 1)
    }
    if (!hasMore) break
  }
  return days
}

/**
 * The photo days (newest first, `YYYY-MM-DD`) that have a recorded activity,
 * with how many. Walks the days newest first and asks only for the windows those
 * days fall in, stopping once `MAX_SUGGESTIONS_PER_KIND` days matched (or the
 * window bound is spent), so a long history of activities never hides the
 * newest days.
 */
const findActivityDays = async (
  database: Pick<SuggestionDatabase, 'getFitnessActivitiesInWindow'>,
  ownerId: string,
  timeZone: string,
  photoDays: string[]
): Promise<Map<string, number>> => {
  const keys = [...photoDays].sort().reverse() as DateKey[]
  const matched = new Map<string, number>()
  let index = 0
  for (
    let windows = 0;
    index < keys.length &&
    windows < MAX_ACTIVITY_WINDOWS &&
    matched.size < MAX_SUGGESTIONS_PER_KIND;
    windows += 1
  ) {
    const newest = keys[index]
    const oldestAllowed = addDays(newest, -(ACTIVITY_WINDOW_SPAN_DAYS - 1))
    const group: DateKey[] = []
    while (index < keys.length && keys[index] >= oldestAllowed) {
      group.push(keys[index])
      index += 1
    }
    const counts = await readActivityWindow(
      database,
      ownerId,
      timeZone,
      group[group.length - 1],
      newest
    )
    for (const key of group) {
      const count = counts.get(key)
      if (count) matched.set(key, count)
    }
  }
  return matched
}

const newestName = (rows: GalleryIndexRow[]): string => {
  const newest = rows[0]
  return (
    newest.subjectName?.trim() || newest.subjectScientificName?.trim() || ''
  )
}

/**
 * The photos a title may speak for: those a logged-out visitor can see, so a
 * followers-only photo never puts its date, place or species name into text that
 * is public once the album is. A cluster with none of them keeps all its rows
 * for the dates (and gets no place).
 */
const splitForTitle = (
  rows: GalleryIndexRow[],
  publicIds: ReadonlySet<string>
): { shown: GalleryIndexRow[]; dated: GalleryIndexRow[] } => {
  const shown = rows.filter((row) => publicIds.has(row.id))
  return { shown, dated: shown.length > 0 ? shown : rows }
}

/** The local day keys of the first and last dated photo of some rows. */
const dayRange = (
  rows: GalleryIndexRow[],
  timeZone: string
): { first: string; last: string } => {
  let first = Infinity
  let last = -Infinity
  for (const row of rows) {
    if (row.takenAt === null) continue
    first = Math.min(first, row.takenAt)
    last = Math.max(last, row.takenAt)
  }
  return {
    first: toLocalDayKey(first, timeZone) ?? '',
    last: toLocalDayKey(last, timeZone) ?? ''
  }
}

/** The groups made from the photos alone, before coverage and the activity lookup. */
const buildPhotoCandidates = ({
  index,
  publicIds,
  settings,
  timeZone
}: {
  index: GalleryIndexRow[]
  publicIds: ReadonlySet<string>
  settings: GallerySettings
  timeZone: string
}) => {
  const trips: Candidate[] = []
  for (const cluster of clusterTrips(index, {
    maxGapDays: TRIP_MAX_GAP_DAYS,
    minPhotos: TRIP_MIN_PHOTOS,
    timeZone
  })) {
    const rows = [...cluster].sort(compareNewestFirst)
    const { shown, dated } = splitForTitle(rows, publicIds)
    const all = dayRange(rows, timeZone)
    const range = dayRange(dated, timeZone)
    trips.push({
      id: `trip:${all.first}`,
      kind: 'trip',
      title: getTripTitle(
        shown,
        settings,
        dayKeyToMs(range.first),
        dayKeyToMs(range.last)
      ),
      rows,
      activityCount: 0
    })
  }

  const species: Candidate[] = []
  for (const [key, group] of groupSpecies(index, SPECIES_MIN_PHOTOS)) {
    const rows = [...group].sort(compareNewestFirst)
    const { dated } = splitForTitle(rows, publicIds)
    species.push({
      id: `species:${key}`,
      kind: 'species',
      title: getSpeciesTitle(newestName(dated)),
      rows,
      activityCount: 0
    })
  }

  const photoDays = groupPhotosByDay(index, ACTIVITY_DAY_MIN_PHOTOS, timeZone)
  return { trips, species, photoDays }
}

const KIND_ORDER: Record<GalleryAlbumSuggestionKind, number> = {
  trip: 0,
  species: 1,
  activity_day: 2
}

/** The newest photo's time (the rows are newest first): the listing order. */
const lastTimeOf = (candidate: Candidate): number =>
  getRowTime(candidate.rows[0])

/**
 * The owner's album suggestions, most recent first. `timeZone` is the viewer's
 * IANA zone: it says which local day a photo was taken on and which a recorded
 * activity belongs to, so the two meet on one day.
 */
export const getGalleryAlbumSuggestions = async ({
  database,
  owner,
  timeZone = 'UTC'
}: {
  database: SuggestionDatabase
  // The gallery's owner: a local actor, and the signed-in one.
  owner: { id: string }
  timeZone?: string
}): Promise<GalleryAlbumSuggestionsResponse> => {
  const [index, publicIndex, settings] = await Promise.all([
    readIndex(database, owner.id, OWNER_GALLERY_AUDIENCE),
    // What a logged-out visitor can see of the same gallery: titles speak only
    // for those photos.
    readIndex(database, owner.id, PUBLIC_GALLERY_AUDIENCE),
    database.getGallerySettings({ actorId: owner.id })
  ])
  const publicIds = new Set(publicIndex.map((row) => row.id))

  const { trips, species, photoDays } = buildPhotoCandidates({
    index,
    publicIds,
    settings,
    timeZone
  })

  // Which of the candidates' photos an album holds: only those are read, in
  // batches, whatever the size of the owner's albums.
  const candidateIds = new Set<string>()
  for (const group of [
    ...trips.map(({ rows }) => rows),
    ...species.map(({ rows }) => rows),
    ...photoDays.values()
  ]) {
    for (const row of group) candidateIds.add(row.id)
  }
  const albumSets =
    candidateIds.size === 0
      ? []
      : await database.getGalleryAlbumItemSets({
          actorId: owner.id,
          mediaIds: [...candidateIds]
        })
  const albums = new Map(
    albumSets.map(({ albumId, mediaIds }) => [albumId, new Set(mediaIds)])
  )
  const isOpen = (rows: GalleryIndexRow[]) =>
    !isCoveredByOneAlbum(
      rows.map((row) => row.id),
      albums
    )

  // Activity days: only photo days no album covers, and only the newest
  // windows of them are looked up.
  const openDays = [...photoDays].filter(([, rows]) => isOpen(rows))
  const activityDays =
    openDays.length === 0
      ? new Map<string, number>()
      : await findActivityDays(
          database,
          owner.id,
          timeZone,
          openDays.map(([day]) => day)
        )
  const activityCandidates: Candidate[] = []
  for (const [day, group] of openDays) {
    const activityCount = activityDays.get(day)
    if (!activityCount) continue
    const rows = [...group].sort(compareNewestFirst)
    activityCandidates.push({
      id: `activity_day:${day}`,
      kind: 'activity_day',
      title: getActivityDayTitle(dayKeyToMs(day)),
      rows,
      activityCount
    })
  }

  // Covered ones are already out, so the per-kind cap is spent on suggestions
  // the owner can still use.
  const open = [
    ...trips.filter(({ rows }) => isOpen(rows)),
    ...species.filter(({ rows }) => isOpen(rows)),
    ...activityCandidates
  ]
  const byRecency = (a: Candidate, b: Candidate) =>
    lastTimeOf(b) - lastTimeOf(a) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.id.localeCompare(b.id, 'en')
  const chosen = (Object.keys(KIND_ORDER) as GalleryAlbumSuggestionKind[])
    .flatMap((kind) =>
      open
        .filter((candidate) => candidate.kind === kind)
        .sort(byRecency)
        .slice(0, MAX_SUGGESTIONS_PER_KIND)
    )
    .sort(byRecency)
  if (chosen.length === 0) return { suggestions: [] }

  // One batch read for every suggestion's first photo, which is its preview
  // (and, once used, the album's cover).
  const previewIds = [...new Set(chosen.map(({ rows }) => rows[0].id))]
  const previewRows = await database.getGalleryMediaByIds({
    actorId: owner.id,
    audience: OWNER_GALLERY_AUDIENCE,
    mediaIds: previewIds
  })
  const previews = await projectRows(
    database,
    previewRows,
    OWNER_GALLERY_AUDIENCE,
    settings
  )

  return {
    suggestions: chosen.map((candidate): GalleryAlbumSuggestionEntity => {
      const facts = computeGalleryIndexFacts(candidate.rows, settings)
      return {
        id: candidate.id,
        kind: candidate.kind,
        title: candidate.title,
        photoCount: candidate.rows.length,
        firstAt: facts.firstAt,
        lastAt: facts.lastAt,
        preview: previews.get(candidate.rows[0].id) ?? null,
        mediaIds: candidate.rows
          .slice(0, MAX_SUGGESTION_MEDIA_IDS)
          .map((row) => row.id),
        truncated: candidate.rows.length > MAX_SUGGESTION_MEDIA_IDS,
        placeCount: facts.placeCount,
        speciesCount: facts.speciesCount,
        activityCount: candidate.activityCount
      }
    })
  }
}

/**
 * The owner's own photos behind some media ids, in the order asked, for the
 * dialog's "review and trim" grid. Anything that is not in the owner's gallery
 * scope (another account's media, an unposted upload, a deleted post's photo,
 * a photo taken out of the gallery) is simply absent.
 */
export const getGallerySuggestionMedia = async ({
  database,
  owner,
  mediaIds
}: {
  database: Pick<
    SuggestionDatabase,
    'getGallerySettings' | 'getGalleryGearNamesByIds' | 'getGalleryMediaByIds'
  >
  owner: { id: string }
  mediaIds: string[]
}): Promise<GalleryAlbumSuggestionMediaResponse> => {
  const [rows, settings] = await Promise.all([
    database.getGalleryMediaByIds({
      actorId: owner.id,
      audience: OWNER_GALLERY_AUDIENCE,
      mediaIds
    }),
    database.getGallerySettings({ actorId: owner.id })
  ])
  const items = await projectRows(
    database,
    rows,
    OWNER_GALLERY_AUDIENCE,
    settings
  )
  const ordered: GalleryItemEntity[] = []
  for (const id of new Set(mediaIds)) {
    const item = items.get(id)
    if (item) ordered.push(item)
  }
  return { items: ordered }
}
