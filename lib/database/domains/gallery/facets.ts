import { activityPhotoAttachments } from '@/lib/database/domains/gallery/activityPhotos'
import type {
  GalleryMediaFacetRows,
  GetGalleryMediaFacetRowsParams
} from '@/lib/database/domains/gallery/types'
import type { Db } from '@/lib/database/kysely'
import { utcYearMonth } from '@/lib/database/kysely/dialect'
import { galleryMediaScope } from '@/lib/database/kysely/visibility/galleryMedia'

export const getGalleryMediaFacetRows = async (
  db: Db,
  { actorId, show }: GetGalleryMediaFacetRowsParams
): Promise<GalleryMediaFacetRows> => {
  const scope = galleryMediaScope(db, actorId, { kind: 'owner' }, { show })
  const monthExpr = utcYearMonth(db, 'medias.sortAt')

  const totalRow = await db
    .selectFrom('medias')
    .select((eb) => eb.fn.countAll<number | string>().as('count'))
    .where(scope)
    .executeTakeFirst()
  const total = Number(totalRow?.count ?? 0)

  const placeRows = await db
    .selectFrom('medias')
    .select([
      'medias.placeName as placeName',
      (eb) => eb.fn.countAll<number | string>().as('count')
    ])
    .where(scope)
    .groupBy('medias.placeName')
    .orderBy((eb) => eb.fn.min('medias.id'), 'asc')
    .execute()

  const places = placeRows.map((row) => ({
    placeName: row.placeName,
    count: Number(row.count)
  }))

  const monthRows = await db
    .selectFrom('medias')
    .select([
      monthExpr.as('month'),
      (eb) => eb.fn.countAll<number | string>().as('count')
    ])
    .where(scope)
    .where('medias.sortAt', 'is not', null)
    .groupBy(monthExpr)
    .execute()

  const months = monthRows.map((row) => ({
    month: row.month,
    count: Number(row.count)
  }))

  const subjectRows = await db
    .selectFrom('medias')
    .select([
      'medias.subjectName as subjectName',
      'medias.subjectScientificName as subjectScientificName',
      'medias.subjectCategory as subjectCategory',
      (eb) => eb.fn.countAll<number | string>().as('count')
    ])
    .where(scope)
    .groupBy([
      'medias.subjectName',
      'medias.subjectScientificName',
      'medias.subjectCategory'
    ])
    .orderBy((eb) => eb.fn.min('medias.id'), 'asc')
    .execute()

  const subjects = subjectRows.map((row) => ({
    subjectName: row.subjectName,
    subjectScientificName: row.subjectScientificName,
    subjectCategory:
      row.subjectCategory as GalleryMediaFacetRows['subjects'][number]['subjectCategory'],
    count: Number(row.count)
  }))

  const activityMediaRow = await activityPhotoAttachments(db, actorId, {
    includeRouteMap: true
  })
    .innerJoin('medias', 'medias.id', 'activity_attachments.mediaId')
    .where(scope)
    .select((eb) =>
      eb.fn.count<number | string>('medias.id').distinct().as('count')
    )
    .executeTakeFirst()

  const activityPhotosRows = await activityPhotoAttachments(db, actorId)
    .innerJoin('medias', 'medias.id', 'activity_attachments.mediaId')
    .where(scope)
    .select([
      'fitness_files.id as fitnessFileId',
      'fitness_files.activityType as activityType',
      'fitness_files.activityStartTime as activityStartTime',
      'fitness_files.totalDistanceMeters as totalDistanceMeters',
      'medias.id as mediaId',
      'medias.placeName as placeName'
    ])
    .execute()

  const activityPhotos = activityPhotosRows.map((row) => ({
    fitnessFileId: row.fitnessFileId,
    activityType: row.activityType,
    activityStartTime:
      row.activityStartTime !== null && row.activityStartTime !== undefined
        ? Number(row.activityStartTime)
        : null,
    totalDistanceMeters:
      row.totalDistanceMeters !== null && row.totalDistanceMeters !== undefined
        ? Number(row.totalDistanceMeters)
        : null,
    mediaId: String(row.mediaId),
    placeName: row.placeName
  }))

  return {
    total,
    places,
    months,
    subjects,
    activityMediaCount: Number(activityMediaRow?.count ?? 0),
    activityPhotos
  }
}
