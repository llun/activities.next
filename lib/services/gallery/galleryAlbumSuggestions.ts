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
  photoActivityDays,
  toUtcDayKey
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
import { isStatusPubliclyReadable } from '@/lib/services/statusAccess'
import { GallerySettings } from '@/lib/types/database/gallery'

// Album suggestions: groups of the owner's own gallery photos that probably
// belong in one album. They are computed on demand from the owner's gallery
// scope (in the gallery, on a post of theirs that still exists) and never
// stored, so a suggestion is exactly as fresh as the request.
//
// - Trip: photos with a capture date, split where two neighbouring days are
//   more than `TRIP_MAX_GAP_DAYS` apart.
// - Species series: a species with at least `SPECIES_MIN_PHOTOS` photos.
// - Activity day: a day on which the owner recorded a fitness activity and took
//   at least `ACTIVITY_DAY_MIN_PHOTOS` photos.
//
// A photo's day is its UTC date, the date the gallery shows (see
// `galleryAlbumSuggestionGroups.ts`); an activity's day is read in the viewer's
// zone, and a photo day also matches an activity on the viewer-local day of any
// of its photos.
//
// A suggestion that one existing album already covers (in the photos it offers)
// is left out, so it does not keep coming back once used. Titles and counts are
// public-safe: see `galleryAlbumSuggestionTitles.ts`.

type SuggestionDatabase = Pick<
  Database,
  | 'getGallerySettings'
  | 'getGalleryGearNamesByIds'
  | 'getGalleryMediaIndex'
  | 'getGalleryMediaByIds'
  | 'getGalleryAlbumItemSets'
  | 'getFitnessActivitiesInWindow'
  | 'getStatus'
>

// Activities are looked up for the newest photo days only, in windows of photo
// days at most this many days from newest to oldest, and for at most this many
// windows a request. The window also takes in the viewer-local dates of those
// photos, which can fall one day beyond each end, so it reads up to two more
// days (33) than that. An activity-day
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
  // The posts the day's activities were published as (activity days only).
  activityStatusIds: string[]
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

// The most statuses of one day's activities that are looked at to say whether
// the day has a public one.
const MAX_ACTIVITY_STATUSES_PER_DAY = 5

interface ActivityDay {
  count: number
  statusIds: string[]
}

/**
 * The recorded activities on each local day (in `timeZone`) of one window of
 * local days, with the posts they were published as, a page at a time. Reads
 * the same countable activities the fitness overview does.
 */
const readActivityWindow = async (
  database: Pick<SuggestionDatabase, 'getFitnessActivitiesInWindow'>,
  ownerId: string,
  timeZone: string,
  firstDay: DateKey,
  lastDay: DateKey
): Promise<Map<string, ActivityDay>> => {
  const { startMs, endMs } = localDayWindow(firstDay, lastDay, timeZone)
  const days = new Map<string, ActivityDay>()
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
      const day = days.get(key) ?? { count: 0, statusIds: [] }
      day.count += 1
      if (
        activity.statusId &&
        day.statusIds.length < MAX_ACTIVITY_STATUSES_PER_DAY &&
        !day.statusIds.includes(activity.statusId)
      ) {
        day.statusIds.push(activity.statusId)
      }
      days.set(key, day)
    }
    if (!hasMore) break
  }
  return days
}

interface PhotoDay {
  // The UTC day of the photos (`YYYY-MM-DD`): the day the album will show.
  day: string
  // The days an activity may be on for these photos: see `photoActivityDays`.
  activityDays: string[]
}

/**
 * The photo days (newest first) that have a recorded activity, with how many
 * and the posts they were published as. Walks the days newest first and asks only
 * for the windows those days fall in, stopping once `MAX_SUGGESTIONS_PER_KIND`
 * days matched (or the window bound is spent), so a long history of activities
 * never hides the newest days.
 */
const findActivityDays = async (
  database: Pick<SuggestionDatabase, 'getFitnessActivitiesInWindow'>,
  ownerId: string,
  timeZone: string,
  photoDays: PhotoDay[]
): Promise<Map<string, ActivityDay>> => {
  const sorted = [...photoDays].sort((a, b) => (a.day < b.day ? 1 : -1))
  const matched = new Map<string, ActivityDay>()
  let index = 0
  for (
    let windows = 0;
    index < sorted.length &&
    windows < MAX_ACTIVITY_WINDOWS &&
    matched.size < MAX_SUGGESTIONS_PER_KIND;
    windows += 1
  ) {
    const oldestAllowed = addDays(
      sorted[index].day as DateKey,
      -(ACTIVITY_WINDOW_SPAN_DAYS - 1)
    )
    const group: PhotoDay[] = []
    while (index < sorted.length && sorted[index].day >= oldestAllowed) {
      group.push(sorted[index])
      index += 1
    }
    const localDays = group.flatMap(({ activityDays }) => activityDays).sort()
    const counts = await readActivityWindow(
      database,
      ownerId,
      timeZone,
      localDays[0] as DateKey,
      localDays[localDays.length - 1] as DateKey
    )
    for (const { day, activityDays } of group) {
      // The photo day's own (UTC) date first. Only when no activity is on it
      // are the viewer-local dates tried, and then only their activities count:
      // a day never takes the activities of two readings at once.
      const own = counts.get(day)
      const found: ActivityDay = own
        ? { count: own.count, statusIds: [...own.statusIds] }
        : { count: 0, statusIds: [] }
      if (!own) {
        for (const activityDay of activityDays) {
          if (activityDay === day) continue
          const activity = counts.get(activityDay)
          if (!activity) continue
          found.count += activity.count
          found.statusIds.push(...activity.statusIds)
        }
      }
      if (found.count > 0) matched.set(day, found)
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
 * is public once the album is. A cluster with none of them gets a generic title.
 */
const shownRows = (
  rows: GalleryIndexRow[],
  publicIds: ReadonlySet<string>
): GalleryIndexRow[] => rows.filter((row) => publicIds.has(row.id))

/** The UTC day keys of the first and last dated photo of some rows. */
const dayRange = (rows: GalleryIndexRow[]): { first: string; last: string } => {
  let first = Infinity
  let last = -Infinity
  for (const row of rows) {
    if (row.takenAt === null) continue
    first = Math.min(first, row.takenAt)
    last = Math.max(last, row.takenAt)
  }
  return { first: toUtcDayKey(first) ?? '', last: toUtcDayKey(last) ?? '' }
}

/** The groups made from the photos alone, before coverage and the activity lookup. */
const buildPhotoCandidates = ({
  index,
  publicIds,
  settings
}: {
  index: GalleryIndexRow[]
  publicIds: ReadonlySet<string>
  settings: GallerySettings
}) => {
  const trips: Candidate[] = []
  for (const cluster of clusterTrips(index, {
    maxGapDays: TRIP_MAX_GAP_DAYS,
    minPhotos: TRIP_MIN_PHOTOS
  })) {
    const rows = [...cluster].sort(compareNewestFirst)
    const shown = shownRows(rows, publicIds)
    const all = dayRange(rows)
    const range = dayRange(shown)
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
      activityCount: 0,
      activityStatusIds: []
    })
  }

  const species: Candidate[] = []
  for (const [key, group] of groupSpecies(index, SPECIES_MIN_PHOTOS)) {
    const rows = [...group].sort(compareNewestFirst)
    const shown = shownRows(rows, publicIds)
    species.push({
      id: `species:${key}`,
      kind: 'species',
      title: getSpeciesTitle(shown.length > 0 ? newestName(shown) : ''),
      rows,
      activityCount: 0,
      activityStatusIds: []
    })
  }

  const photoDays = groupPhotosByDay(index, ACTIVITY_DAY_MIN_PHOTOS)
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
 * Whether one of a day's activities is on a post a logged-out visitor can read:
 * only then may an album title say there was an activity that day.
 */
const hasPublicActivity = async (
  database: Pick<SuggestionDatabase, 'getStatus'>,
  statusIds: string[]
): Promise<boolean> => {
  for (const statusId of statusIds.slice(0, MAX_ACTIVITY_STATUSES_PER_DAY)) {
    const status = await database.getStatus({ statusId, withReplies: false })
    if (status && isStatusPubliclyReadable(status)) return true
  }
  return false
}

/**
 * The owner's album suggestions, most recent first. `timeZone` is the viewer's
 * IANA zone: it says which local day a recorded activity belongs to, which a
 * photo day is matched against (see `photoActivityDays`).
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
    settings
  })

  // A suggestion hands the dialog its first `MAX_SUGGESTION_MEDIA_IDS` photos,
  // so those are the photos an album has to hold to cover it (and the only ones
  // whose membership is read, in batches, whatever the size of the albums).
  const offeredIds = (rows: GalleryIndexRow[]) =>
    rows.slice(0, MAX_SUGGESTION_MEDIA_IDS).map((row) => row.id)
  const candidateIds = new Set<string>()
  for (const group of [
    ...trips.map(({ rows }) => rows),
    ...species.map(({ rows }) => rows),
    ...photoDays.values()
  ]) {
    for (const id of offeredIds([...group].sort(compareNewestFirst))) {
      candidateIds.add(id)
    }
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
    !isCoveredByOneAlbum(offeredIds(rows), albums)

  // Activity days: only photo days no album covers, and only the newest
  // windows of them are looked up.
  const openDays = [...photoDays]
    .map(([day, group]): [string, GalleryIndexRow[]] => [
      day,
      [...group].sort(compareNewestFirst)
    ])
    .filter(([, rows]) => isOpen(rows))
  const activityDays =
    openDays.length === 0
      ? new Map<string, ActivityDay>()
      : await findActivityDays(
          database,
          owner.id,
          timeZone,
          openDays.map(([day, rows]) => ({
            day,
            activityDays: photoActivityDays(day, rows, timeZone)
          }))
        )
  const activityCandidates: Candidate[] = []
  for (const [day, rows] of openDays) {
    const activity = activityDays.get(day)
    if (!activity) continue
    activityCandidates.push({
      id: `activity_day:${day}`,
      kind: 'activity_day',
      // The title is set once the suggestions are chosen.
      title: '',
      rows,
      activityCount: activity.count,
      activityStatusIds: activity.statusIds
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

  // An activity day's title says "Activity day" only when one of its activities
  // is on a post visitors can read, and dates only photos they can see.
  for (const candidate of chosen) {
    if (candidate.kind !== 'activity_day') continue
    const shown = shownRows(candidate.rows, publicIds)
    candidate.title =
      shown.length === 0
        ? getActivityDayTitle(null, false)
        : getActivityDayTitle(
            dayKeyToMs(dayRange(shown).first),
            await hasPublicActivity(database, candidate.activityStatusIds)
          )
  }

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
