import { type Expression, type SqlBool, expressionBuilder, sql } from 'kysely'

import { activityPhotoAttachments } from '@/lib/database/domains/gallery/activityPhotos'
import type {
  CountGalleryMediaParams,
  GalleryMediaCount,
  GalleryMediaFilters
} from '@/lib/database/domains/gallery/types'
import type { DB, Db } from '@/lib/database/kysely'
import { timestampValue } from '@/lib/database/kysely/dialect'
import {
  galleryMediaIdRef,
  galleryMediaScope
} from '@/lib/database/kysely/visibility/galleryMedia'
import type { GalleryAudience } from '@/lib/services/gallery/galleryAudience'
import {
  toPlaceKey,
  toSubjectKey
} from '@/lib/services/gallery/galleryEntities'
import { GALLERY_FILTER_NONE } from '@/lib/types/database/gallery'

const parseDateBound = (
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

export const countGalleryMedia = async (
  db: Db,
  params: CountGalleryMediaParams
): Promise<GalleryMediaCount> => {
  const { actorId, audience, show, gearId, filters, albumId, sort } = params

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

  let baseQuery = db
    .selectFrom('medias')
    .where(galleryMediaScope(db, actorId, audience, { show }))

  if (filterExpr !== null) {
    baseQuery = baseQuery.where(filterExpr)
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

  const subquery = db
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

  const inAlbumRow = await baseQuery
    .where((eb) => eb.exists(subquery))
    .select((eb) => eb.fn.countAll<number | string>().as('count'))
    .executeTakeFirst()

  return { total, inAlbum: Number(inAlbumRow?.count ?? 0) }
}
