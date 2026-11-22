import { type Expression, type SqlBool, expressionBuilder, sql } from 'kysely'

import { activityPhotoAttachments } from '@/lib/database/domains/gallery/activityPhotos'
import { galleryDayKeyBound } from '@/lib/database/domains/gallery/dayStats'
import type {
  CountGalleryMediaParams,
  GalleryMediaCount,
  GalleryMediaFilters
} from '@/lib/database/domains/gallery/types'
import { parseTaxonPath } from '@/lib/database/domains/media/rows'
import {
  foldSearchText,
  getSearchTokens
} from '@/lib/database/domains/search/rows'
import type { DB, Db } from '@/lib/database/kysely'
import { inIntegerList, timestampValue } from '@/lib/database/kysely/dialect'
import {
  galleryMediaIdRef,
  galleryMediaScope,
  postedGalleryAttachment
} from '@/lib/database/kysely/visibility/galleryMedia'
import type { GalleryAudience } from '@/lib/services/gallery/galleryAudience'
import {
  toPlaceKey,
  toSubjectKey
} from '@/lib/services/gallery/galleryEntities'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'

export const parseDateBound = (
  dateStr: string
): { year: number; month: number; day: number } | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

type GalleryQueryCandidate = {
  id: number | string
  altText: string | null
  subjectName: string | null
  subjectScientificName: string | null
  subjectCategory: string | null
  subjectTaxonPath: string | null
  placeName: string | null
}

// The rows a search reads. The owner searches every media row of theirs, with
// its own alt text and place name. Anyone else searches only the media posted
// on a status they may read, by the alt text of those posts (the attachment's
// `name`, what they are shown; never the media row's, which the owner may have
// changed since) and never by place: a hidden location, a threatened species'
// place or a precision that withholds the name must not be findable.
const galleryQueryCandidates = async (
  db: Db,
  actorId: string,
  audience: GalleryAudience
): Promise<GalleryQueryCandidate[]> => {
  if (audience?.kind === 'owner') {
    return db
      .selectFrom('medias')
      .select([
        'medias.id',
        'medias.description as altText',
        'medias.subjectName',
        'medias.subjectScientificName',
        'medias.subjectCategory',
        'medias.subjectTaxonPath',
        'medias.placeName'
      ])
      .where('medias.actorId', '=', actorId)
      .execute()
  }
  return db
    .selectFrom('attachments as gallery_attachments')
    .innerJoin('medias', (join) =>
      join.on('gallery_attachments.mediaId', '=', galleryMediaIdRef)
    )
    .innerJoin(
      'statuses as gallery_statuses',
      'gallery_statuses.id',
      'gallery_attachments.statusId'
    )
    .select([
      'medias.id',
      'gallery_attachments.name as altText',
      'medias.subjectName',
      'medias.subjectScientificName',
      'medias.subjectCategory',
      'medias.subjectTaxonPath',
      sql<null>`null`.as('placeName')
    ])
    .where('medias.actorId', '=', actorId)
    .where('medias.inGallery', '=', true)
    .where(postedGalleryAttachment(db, actorId, audience))
    .execute()
}

// The words a group answers to besides its prefix and its regular plural.
const GROUP_IRREGULAR_PLURALS: Record<string, string> = { fungus: 'fungi' }

// The ids of the actor's media that hold every word of `query`, each word in
// any searchable field, folded as post search folds (lowercase, accents and
// compatibility forms removed). `undefined` when the query has no word (no
// filter), `null` when nothing matches. Matching runs in JavaScript over
// `galleryQueryCandidates` so it folds the same on SQLite and PostgreSQL.
// shortcut: reads the actor's media rows per search; fine for the per-account
// counts galleries hold, move to an index if accounts grow far past tens of
// thousands of photos.
const galleryQueryMatchIds = async (
  db: Db,
  actorId: string,
  query: string,
  audience: GalleryAudience
): Promise<number[] | null | undefined> => {
  const words = getSearchTokens(query)
  if (words.length === 0) return undefined
  // A media posted more than once has a row per attachment; its text is all of
  // them together.
  const texts = new Map<number, { text: string[]; category: string }>()
  for (const row of await galleryQueryCandidates(db, actorId, audience)) {
    const id = Number(row.id)
    const entry = texts.get(id) ?? {
      text: [
        row.subjectName,
        row.subjectScientificName,
        ...(parseTaxonPath(row.subjectTaxonPath) ?? []),
        row.placeName
      ].filter((value): value is string => Boolean(value)),
      category: row.subjectCategory ? foldSearchText(row.subjectCategory) : ''
    }
    if (row.altText) entry.text.push(row.altText)
    texts.set(id, entry)
  }
  const ids: number[] = []
  for (const [id, { text, category }] of texts) {
    const folded = foldSearchText(text.join(' '))
    const irregular = GROUP_IRREGULAR_PLURALS[category]
    // A group is matched by its prefix or a plural ("bir", "birds", "fishes"
    // and "fungi" find their group; "birdhouse" does not).
    const matches = words.every(
      (word) =>
        folded.includes(word) ||
        (category !== '' &&
          (category.startsWith(word) ||
            word === irregular ||
            (word.startsWith(category) && word.length - category.length <= 2)))
    )
    if (matches) ids.push(id)
  }
  return ids.length > 0 ? ids : null
}

export const galleryMediaFilter = async (
  db: Db,
  actorId: string,
  audience: GalleryAudience,
  filters?: GalleryMediaFilters,
  gearId?: string
): Promise<Expression<SqlBool> | null | false> => {
  const eb = expressionBuilder<DB, 'medias'>()
  const conditions: Expression<SqlBool>[] = []

  if (gearId !== undefined) {
    conditions.push(
      eb.or([
        eb('medias.cameraGearId', '=', gearId),
        eb('medias.lensGearId', '=', gearId)
      ])
    )
  }

  if (filters?.category !== undefined) {
    conditions.push(eb('medias.subjectCategory', '=', filters.category))
  }

  if (filters?.subjectKey !== undefined) {
    const rows = await db
      .selectFrom('medias')
      .select(['medias.subjectName', 'medias.subjectScientificName'])
      .distinct()
      .where('medias.actorId', '=', actorId)
      .where((eb) =>
        eb.or([
          eb('medias.subjectName', 'is not', null),
          eb('medias.subjectScientificName', 'is not', null)
        ])
      )
      .execute()

    const matching = rows.filter((r) => {
      const k = toSubjectKey({
        name: r.subjectName,
        scientificName: r.subjectScientificName
      })
      return k === filters.subjectKey
    })

    if (matching.length === 0) return false

    if (filters.subjectKey.startsWith('sci:')) {
      const rawSci = [
        ...new Set(
          matching
            .map((r) => r.subjectScientificName)
            .filter((s): s is string => typeof s === 'string' && s.length > 0)
        )
      ]
      if (rawSci.length === 0) return false
      // shortcut: unchunked IN list; distinct spellings per key are a handful
      conditions.push(eb('medias.subjectScientificName', 'in', rawSci))
    } else if (filters.subjectKey.startsWith('name:')) {
      const rawNames = [
        ...new Set(
          matching
            .map((r) => r.subjectName)
            .filter((n): n is string => typeof n === 'string' && n.length > 0)
        )
      ]
      if (rawNames.length === 0) return false

      const rawSciWithEmptyNorm = [
        ...new Set(
          matching
            .map((r) => r.subjectScientificName)
            .filter((s): s is string => typeof s === 'string')
        )
      ]

      // shortcut: unchunked IN list; distinct spellings per key are a handful
      conditions.push(
        eb.and([
          eb('medias.subjectName', 'in', rawNames),
          rawSciWithEmptyNorm.length > 0
            ? eb.or([
                eb('medias.subjectScientificName', 'is', null),
                eb('medias.subjectScientificName', 'in', rawSciWithEmptyNorm)
              ])
            : eb('medias.subjectScientificName', 'is', null)
        ])
      )
    } else {
      return false
    }
  }

  if (filters?.query !== undefined) {
    const ids = await galleryQueryMatchIds(db, actorId, filters.query, audience)
    if (ids === null) return false
    if (ids !== undefined) conditions.push(inIntegerList(db, 'medias.id', ids))
  }

  if (audience?.kind === 'owner') {
    if (filters?.placeKey !== undefined) {
      const isNoPlace = filters.placeKey === ''

      const placeRows = await db
        .selectFrom('medias')
        .select('medias.placeName')
        .distinct()
        .where('medias.actorId', '=', actorId)
        .where('medias.placeName', 'is not', null)
        .execute()

      if (isNoPlace) {
        const blankSpellings = [
          ...new Set(
            placeRows
              .map((r) => r.placeName)
              .filter(
                (raw): raw is string =>
                  typeof raw === 'string' && toPlaceKey(raw) === ''
              )
          )
        ]
        if (blankSpellings.length > 0) {
          // shortcut: unchunked IN list; distinct spellings per key are a handful
          conditions.push(
            eb.or([
              eb('medias.placeName', 'is', null),
              eb('medias.placeName', 'in', blankSpellings)
            ])
          )
        } else {
          conditions.push(eb('medias.placeName', 'is', null))
        }
      } else {
        const matchingPlaces = [
          ...new Set(
            placeRows
              .map((r) => r.placeName)
              .filter(
                (raw): raw is string =>
                  typeof raw === 'string' &&
                  toPlaceKey(raw) === filters.placeKey
              )
          )
        ]
        if (matchingPlaces.length === 0) {
          return false
        }
        // shortcut: unchunked IN list; distinct spellings per key are a handful
        conditions.push(eb('medias.placeName', 'in', matchingPlaces))
      }
    }

    if (filters?.takenFrom !== undefined) {
      const bound = parseDateBound(filters.takenFrom)
      if (!bound) return false
      const fromUtc = Date.UTC(bound.year, bound.month - 1, bound.day)
      conditions.push(eb('medias.sortAt', '>=', timestampValue(fromUtc)))
    }

    if (filters?.takenTo !== undefined) {
      const bound = parseDateBound(filters.takenTo)
      if (!bound) return false
      const toUtc = Date.UTC(bound.year, bound.month - 1, bound.day + 1)
      conditions.push(eb('medias.sortAt', '<', timestampValue(toUtc)))
    }

    if (filters?.activityId !== undefined) {
      if (
        filters.activityId === null ||
        filters.activityId === GALLERY_FILTER_NONE
      ) {
        // Any media on an activity's post, route map included, is from it.
        const subquery = activityPhotoAttachments(db, actorId, {
          includeRouteMap: true
        })
          .select(sql.lit(1).as('one'))
          .where('activity_attachments.mediaId', '=', galleryMediaIdRef)
        conditions.push(eb.not(eb.exists(subquery)))
      } else {
        const subquery = activityPhotoAttachments(db, actorId)
          .select(sql.lit(1).as('one'))
          .where('activity_attachments.mediaId', '=', galleryMediaIdRef)
          .where('fitness_files.id', '=', filters.activityId)
        conditions.push(eb.exists(subquery))
      }
    }
  }

  if (conditions.length === 0) return null
  if (conditions.length === 1) return conditions[0]
  return eb.and(conditions)
}

/**
 * The `gallery_album_items ⨝ gallery_albums` subquery selecting `sql.lit(1)`
 * that says "this media is in that album of the owner": reused by the album
 * count and the day stats' `inAlbum` sums and the `ids_only` exclusion.
 */
export const inAlbumExists = (db: Db, actorId: string, albumId: string) =>
  db
    .selectFrom('gallery_album_items')
    .innerJoin(
      'gallery_albums',
      'gallery_albums.id',
      'gallery_album_items.albumId'
    )
    .select(sql.lit(1).as('one'))
    .where('gallery_album_items.albumId', '=', albumId)
    .where('gallery_albums.actorId', '=', actorId)
    .where('gallery_album_items.mediaId', '=', galleryMediaIdRef)

export const countGalleryMedia = async (
  db: Db,
  params: CountGalleryMediaParams
): Promise<GalleryMediaCount> => {
  const { actorId, audience, show, gearId, filters, albumId, sort, dayKey } =
    params

  const filterExpr = await galleryMediaFilter(
    db,
    actorId,
    audience,
    filters,
    gearId
  )
  if (filterExpr === false) {
    return { total: 0, inAlbum: albumId !== undefined ? 0 : null }
  }

  // The same day bound the list applies (owner only): a count for a
  // day-restricted list covers that day alone, and an unparsable key counts
  // the nothing the list reads for it.
  const isOwner = audience?.kind === 'owner'
  const effectiveSort = isOwner ? (sort ?? 'uploaded') : 'uploaded'
  const effectiveDayKey = isOwner ? dayKey : undefined
  const dayBound =
    effectiveDayKey !== undefined
      ? galleryDayKeyBound(db, effectiveSort, effectiveDayKey)
      : null
  if (effectiveDayKey !== undefined && dayBound === null) {
    return { total: 0, inAlbum: albumId !== undefined ? 0 : null }
  }

  let baseQuery = db
    .selectFrom('medias')
    .where(galleryMediaScope(db, actorId, audience, { show }))

  if (filterExpr !== null) {
    baseQuery = baseQuery.where(filterExpr)
  }

  if (dayBound !== null) {
    baseQuery = baseQuery.where(dayBound)
  }

  // Same rule as getGalleryMedia: date orders skip rows with no sortAt.
  if (audience?.kind === 'owner' && sort !== undefined && sort !== 'uploaded') {
    baseQuery = baseQuery.where('medias.sortAt', 'is not', null)
  }

  const totalRow = await baseQuery
    .select((eb) => eb.fn.countAll<number | string>().as('count'))
    .executeTakeFirst()
  const total = Number(totalRow?.count ?? 0)

  if (albumId === undefined) {
    return { total, inAlbum: null }
  }

  const subquery = inAlbumExists(db, actorId, albumId)

  const inAlbumRow = await baseQuery
    .where((eb) => eb.exists(subquery))
    .select((eb) => eb.fn.countAll<number | string>().as('count'))
    .executeTakeFirst()

  return { total, inAlbum: Number(inAlbumRow?.count ?? 0) }
}
