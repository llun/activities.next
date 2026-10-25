import {
  type Expression,
  type ExpressionBuilder,
  type SqlBool,
  expressionBuilder,
  sql
} from 'kysely'

import { activityPhotoAttachments } from '@/lib/database/domains/gallery/activityPhotos'
import {
  galleryMediaFilter,
  inAlbumExists,
  parseDateBound
} from '@/lib/database/domains/gallery/mediaFilters'
import { normalizeLimit } from '@/lib/database/domains/gallery/rows'
import type {
  GalleryDayStatsRows,
  GetGalleryDayStatsParams,
  GetGalleryMediaIdsParams
} from '@/lib/database/domains/gallery/types'
import type { DB, Db } from '@/lib/database/kysely'
import { timestampValue, utcDay } from '@/lib/database/kysely/dialect'
import { galleryMediaScope } from '@/lib/database/kysely/visibility/galleryMedia'
import { parseGalleryDayKey } from '@/lib/services/gallery/galleryEntities'
import type { GalleryMediaSort } from '@/lib/types/database/gallery'

// The per-day reads behind `include_days` and `ids_only` on
// GET /api/v1/accounts/:id/gallery/media. Both are owner-only: the day stats
// carry full-day counts (how many matches a half-loaded day has in total) and
// the ids read hands out the owner's whole day, so a non-owner audience gets
// the empty result before any query runs.

// The bound on the sort's day column for the UTC days fromDay..toDay
// (inclusive). Date sorts bound by `sortAt` (INTEGER by construction, so
// `medias_actorId_sortAt_id_idx` applies); `uploaded` compares the utcDay()
// expression as a string.
const galleryDayColumnBound = (
  db: Db,
  sort: GalleryMediaSort,
  fromDay: string,
  toDay: string
): Expression<SqlBool> | null => {
  const eb = expressionBuilder<DB, 'medias'>()
  if (sort === 'uploaded') {
    // shortcut: a scan of the owner's scope per page under sort=uploaded,
    // because SQLite's createdAt is mixed-type; upgrade when a stored
    // upload-day column exists.
    const day = utcDay(db, 'medias.createdAt')
    return eb.and([eb(day, '>=', fromDay), eb(day, '<=', toDay)])
  }
  const from = parseDateBound(fromDay)
  const to = parseDateBound(toDay)
  if (!from || !to) return null
  return eb.and([
    eb(
      'medias.sortAt',
      '>=',
      timestampValue(Date.UTC(from.year, from.month - 1, from.day))
    ),
    eb(
      'medias.sortAt',
      '<',
      timestampValue(Date.UTC(to.year, to.month - 1, to.day + 1))
    )
  ])
}

// The bound of one day key. Under date sorts, dated keys use the sortAt range
// and uploaded keys use createdAt; the takenAt predicate keeps the two groups
// separate when their UTC days differ.
export const galleryDayKeyBound = (
  db: Db,
  sort: GalleryMediaSort,
  key: string
): Expression<SqlBool> | null => {
  const parsed = parseGalleryDayKey(key)
  if (!parsed) return null
  const eb = expressionBuilder<DB, 'medias'>()
  if (sort === 'uploaded') {
    return eb(utcDay(db, 'medias.createdAt'), '=', parsed.day)
  }
  if (parsed.uploaded) {
    return eb.and([
      eb(utcDay(db, 'medias.createdAt'), '=', parsed.day),
      eb('medias.takenAt', 'is', null)
    ])
  }
  const bound = galleryDayColumnBound(db, sort, parsed.day, parsed.day)
  if (!bound) return null
  return eb.and([bound, eb('medias.takenAt', 'is not', null)])
}

export const getGalleryDayStats = async (
  db: Db,
  {
    actorId,
    audience,
    show,
    gearId,
    filters,
    sort,
    fromDay,
    toDay,
    albumId
  }: GetGalleryDayStatsParams
): Promise<GalleryDayStatsRows> => {
  // Defence in depth: the route never asks for a non-owner audience.
  if (audience?.kind !== 'owner') return { places: [], activities: [] }

  const filterExpr = await galleryMediaFilter(
    db,
    actorId,
    audience,
    filters,
    gearId
  )
  if (filterExpr === false) return { places: [], activities: [] }

  const bound = galleryDayColumnBound(db, sort, fromDay, toDay)
  if (!bound) return { places: [], activities: [] }

  const isDateSort = sort !== 'uploaded'
  const dayExpr = isDateSort
    ? sql<string>`case when ${sql.ref('medias.takenAt')} is null then ${utcDay(db, 'medias.createdAt')} else ${utcDay(db, 'medias.sortAt')} end`
    : utcDay(db, 'medias.createdAt')
  const datelessExpr = sql<number>`case when ${sql.ref('medias.takenAt')} is null then 1 else 0 end`
  const scope = galleryMediaScope(db, actorId, audience, { show })

  // `sum(null)` is "function sum(unknown) is not unique" on PostgreSQL, so
  // the no-album read selects a plain null instead of summing one.
  const inAlbumColumn = (eb: ExpressionBuilder<DB, 'medias'>) =>
    albumId !== undefined
      ? eb.fn
          .sum<number | string | bigint | null>(
            eb
              .case()
              .when(eb.exists(inAlbumExists(db, actorId, albumId)))
              .then(1)
              .else(0)
              .end()
          )
          .as('inAlbum')
      : sql<number | null>`null`.as('inAlbum')

  const placeRows = await db
    .selectFrom('medias')
    .select([
      dayExpr.as('day'),
      datelessExpr.as('dateless'),
      'medias.placeName',
      (eb) => eb.fn.countAll<number | string>().as('count'),
      inAlbumColumn
    ])
    .where(scope)
    .$if(filterExpr !== null, (qb) => qb.where(filterExpr!))
    .where(bound)
    .$if(isDateSort, (qb) => qb.where('medias.sortAt', 'is not', null))
    // A fixed row order, so both backends hand the same rows to the
    // service's tie-breaking (the order itself does not decide ties).
    .orderBy(dayExpr)
    .orderBy(datelessExpr)
    .orderBy('medias.placeName')
    .groupBy([dayExpr, datelessExpr, 'medias.placeName'])
    .execute()

  const places = placeRows.map((row) => ({
    day: String(row.day),
    dateless: Number(row.dateless) === 1,
    placeName: row.placeName ?? null,
    count: Number(row.count),
    inAlbum: albumId !== undefined ? Number(row.inAlbum ?? 0) : null
  }))

  const activityRows = await activityPhotoAttachments(db, actorId)
    .innerJoin('medias', 'medias.id', 'activity_attachments.mediaId')
    .where(scope)
    .$if(filterExpr !== null, (qb) => qb.where(filterExpr!))
    .where(bound)
    .$if(isDateSort, (qb) => qb.where('medias.sortAt', 'is not', null))
    .select([
      dayExpr.as('day'),
      datelessExpr.as('dateless'),
      'fitness_files.id as fitnessFileId',
      'fitness_files.activityType as activityType',
      'fitness_files.totalDistanceMeters as totalDistanceMeters',
      'fitness_files.activityStartTime as activityStartTime',
      (eb) => eb.fn.count<number | string>('medias.id').distinct().as('count')
    ])
    .groupBy([
      dayExpr,
      datelessExpr,
      'fitness_files.id',
      'fitness_files.activityType',
      'fitness_files.totalDistanceMeters',
      'fitness_files.activityStartTime'
    ])
    .orderBy(dayExpr)
    .orderBy(datelessExpr)
    .orderBy('fitness_files.id')
    .execute()

  const activities = activityRows.map((row) => ({
    day: String(row.day),
    dateless: Number(row.dateless) === 1,
    fitnessFileId: String(row.fitnessFileId),
    activityType: row.activityType ?? null,
    totalDistanceMeters:
      row.totalDistanceMeters !== null && row.totalDistanceMeters !== undefined
        ? Number(row.totalDistanceMeters)
        : null,
    activityStartTime:
      row.activityStartTime !== null && row.activityStartTime !== undefined
        ? Number(row.activityStartTime)
        : null,
    count: Number(row.count)
  }))

  return { places, activities }
}

export const getGalleryMediaIds = async (
  db: Db,
  {
    actorId,
    audience,
    show,
    gearId,
    filters,
    sort,
    dayKey,
    limit,
    offset = 0,
    excludeAlbumId
  }: GetGalleryMediaIdsParams
): Promise<string[]> => {
  // Owner only: the ids of one day's matches are the owner's whole day.
  if (audience?.kind !== 'owner') return []

  const filterExpr = await galleryMediaFilter(
    db,
    actorId,
    audience,
    filters,
    gearId
  )
  if (filterExpr === false) return []

  const bound = galleryDayKeyBound(db, sort, dayKey)
  if (!bound) return []

  const isDateSort = sort !== 'uploaded'

  let qb = db
    .selectFrom('medias')
    .select('medias.id')
    .where(galleryMediaScope(db, actorId, audience, { show }))

  if (filterExpr !== null) {
    qb = qb.where(filterExpr)
  }

  qb = qb.where(bound)

  // Same rule as getGalleryMedia: date orders skip rows with no sortAt.
  if (isDateSort) {
    qb = qb.where('medias.sortAt', 'is not', null)
  }

  if (excludeAlbumId !== undefined) {
    qb = qb.where((eb) =>
      eb.not(eb.exists(inAlbumExists(db, actorId, excludeAlbumId)))
    )
  }

  // The same ORDER BY as getGalleryMedia, without its cursor.
  if (sort === 'taken_desc') {
    qb = qb.orderBy('medias.sortAt', 'desc').orderBy('medias.id', 'desc')
  } else if (sort === 'taken_asc') {
    qb = qb.orderBy('medias.sortAt', 'asc').orderBy('medias.id', 'asc')
  } else {
    qb = qb.orderBy('medias.id', 'desc')
  }

  const rows = await qb
    .limit(normalizeLimit(limit))
    .offset(Math.max(0, Math.floor(offset)))
    .execute()
  return rows.map((row) => String(row.id))
}
