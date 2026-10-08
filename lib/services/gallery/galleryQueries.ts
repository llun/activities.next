import type {
  GalleryIndexRow,
  GalleryMediaRow
} from '@/lib/database/sql/galleryMedia'
import { toMediaRowId } from '@/lib/database/sql/media'
import { Database } from '@/lib/database/types'
import {
  type GalleryAudience,
  PUBLIC_GALLERY_AUDIENCE
} from '@/lib/services/gallery/galleryAudience'
import {
  GalleryItemEntity,
  GalleryLifeListEntry,
  GalleryLifeListResponse,
  GalleryMapResponse,
  GalleryMediaPage,
  GallerySubjectEntry,
  GallerySubjectGroupCategory,
  GallerySubjectsResponse,
  toSubjectKey
} from '@/lib/services/gallery/galleryEntities'
import {
  getGalleryGearIdsToResolve,
  toGalleryItemEntity,
  toGalleryMapPoint,
  toGalleryProjectionViewer
} from '@/lib/services/gallery/galleryProjection'
import {
  GallerySettings,
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
// those responses say `truncated: true`. A subject or category page filters the
// same index in JS but reads it in windows moved by the cursor, so it can reach
// every photo and needs no `truncated` flag.

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
}

const projectRows = async (
  database: GalleryQueryDatabase,
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

export const getGalleryMediaPage = async ({
  database,
  owner,
  audience,
  maxId,
  limit,
  subjectKey,
  category,
  gearId
}: GetGalleryMediaPageParams): Promise<GalleryMediaPage> => {
  const empty: GalleryMediaPage = { items: [], nextMaxId: null }
  const pageSize = normalizePageLimit(limit)
  const viewer = toGalleryProjectionViewer(audience)
  if (gearId !== undefined && viewer !== 'owner') return empty

  const settings = await database.getGallerySettings({ actorId: owner.id })

  let rows: GalleryMediaRow[]
  let resumeAfter: string | null = null
  if (subjectKey !== undefined || category !== undefined) {
    if (maxId !== undefined && toMediaRowId(maxId) === null) return empty

    // The index is read one window of GALLERY_INDEX_CAP rows at a time, newest
    // first, with the cursor pushed into SQL (`medias.id < cursor`), so a
    // subject with few recent photos is still reachable past the first window.
    // Windows are read until the page (plus the look-ahead row) is full or the
    // index runs out.
    const matches = (row: GalleryIndexRow): boolean =>
      (subjectKey === undefined ||
        toSubjectKey({
          name: row.subjectName,
          scientificName: row.subjectScientificName
        }) === subjectKey) &&
      (category === undefined || row.subjectCategory === category)

    rows = []
    let cursor = maxId
    let windows = 0
    for (;;) {
      const index = await database.getGalleryMediaIndex({
        actorId: owner.id,
        audience,
        limit: GALLERY_INDEX_CAP,
        ...(cursor === undefined ? null : { maxId: cursor })
      })
      windows += 1
      const ids = index.filter(matches).map((row) => row.id)

      // Ids are requested in slices so a short read (a row dropped between the
      // index read and the by-ids read) pulls the next matching ids of this
      // window instead of skipping them. Gear is not in the index, so a gear
      // filter on top of a subject filter is applied after the rows are read,
      // over every matching id.
      let offset = 0
      while (rows.length <= pageSize && offset < ids.length) {
        const needed = pageSize + 1 - rows.length
        const slice =
          gearId === undefined ? ids.slice(offset, offset + needed) : ids
        offset = gearId === undefined ? offset + slice.length : ids.length
        let windowRows = await database.getGalleryMediaByIds({
          actorId: owner.id,
          audience,
          mediaIds: slice
        })
        if (gearId !== undefined) {
          windowRows = windowRows.filter(
            ({ media }) =>
              media.details?.cameraGearId === gearId ||
              media.details?.lensGearId === gearId
          )
        }
        rows.push(...windowRows.slice(0, needed))
      }

      if (rows.length > pageSize || index.length < GALLERY_INDEX_CAP) break
      cursor = index[index.length - 1].id
      if (windows >= MAX_INDEX_WINDOWS) {
        // A filter that matches little must not make one anonymous request
        // scan the whole gallery: hand back what was found and let the client
        // continue from the last scanned id.
        resumeAfter = cursor
        break
      }
    }
  } else {
    // Rows can be dropped after the SQL limit (a post that went away), so a
    // short read is not proof of the end: keep reading from the last row
    // returned until the look-ahead row shows up, a read comes back empty, or
    // the read cap is reached.
    rows = []
    let cursor = maxId
    for (let reads = 0; reads < MAX_INDEX_WINDOWS; reads += 1) {
      const batch = await database.getGalleryMedia({
        actorId: owner.id,
        audience,
        maxId: cursor,
        limit: pageSize + 1 - rows.length,
        gearId
      })
      if (batch.length === 0) break
      rows.push(...batch)
      if (rows.length > pageSize) break
      cursor = batch[batch.length - 1].media.id
      if (reads === MAX_INDEX_WINDOWS - 1) resumeAfter = cursor
    }
  }

  const hasMore = rows.length > pageSize
  const pageRows = rows.slice(0, pageSize)
  const items = await projectRows(database, pageRows, audience, settings)

  return {
    items: pageRows.flatMap((row) => {
      const item = items.get(row.media.id)
      return item ? [item] : []
    }),
    nextMaxId: hasMore ? pageRows[pageRows.length - 1].media.id : resumeAfter
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

const toIso = (time: number | null): string | null =>
  time === null || !Number.isFinite(time) ? null : new Date(time).toISOString()

// Min and max are reduced here, over parsed times, never with SQL MIN/MAX over
// SQLite's mixed storage types.
const summarizeGroup = (
  group: SubjectGroup
): Omit<GallerySubjectEntry, 'cover'> & { coverMediaId: string } => {
  let first: number | null = null
  let last: number | null = null
  for (const row of group.rows) {
    const seenAt = row.takenAt ?? row.createdAt
    if (!Number.isFinite(seenAt)) continue
    if (first === null || seenAt < first) first = seenAt
    if (last === null || seenAt > last) last = seenAt
  }
  return {
    key: group.key,
    // The newest photo's naming wins; older spellings fill gaps.
    name: firstNonNull(group.rows.map((row) => row.subjectName)),
    scientificName: firstNonNull(
      group.rows.map((row) => row.subjectScientificName)
    ),
    category: firstNonNull(group.rows.map((row) => row.subjectCategory)),
    count: group.rows.length,
    firstSeenAt: toIso(first),
    lastSeenAt: toIso(last),
    coverMediaId: group.rows[0].id
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
  const summaries = groups.map(summarizeGroup)

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
  for (const { coverMediaId, ...summary } of summaries) {
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
    truncated
  }
}

export const getGalleryLifeList = async ({
  database,
  owner,
  audience
}: GalleryQueryBase): Promise<GalleryLifeListResponse> => {
  const { rows, truncated } = await readIndex(database, owner.id, audience)
  const { groups } = groupBySubject(rows)

  // A landscape is not a species. A subject with no key never reaches here.
  const entries: GalleryLifeListEntry[] = groups
    .map(summarizeGroup)
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

  return {
    points: rows.slice(0, GALLERY_INDEX_CAP).flatMap((row) => {
      const point = toGalleryMapPoint(row, { viewer, settings, publicMediaIds })
      return point ? [point] : []
    }),
    truncated: rows.length > GALLERY_INDEX_CAP
  }
}
