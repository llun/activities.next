import type {
  GalleryMapRow,
  GalleryMediaRow
} from '@/lib/database/sql/galleryMedia'
import type { GalleryAudience } from '@/lib/services/gallery/galleryAudience'
import {
  GalleryItemEntity,
  GalleryMapPoint,
  GalleryMapPublicState
} from '@/lib/services/gallery/galleryEntities'
import {
  getPublicPlace,
  toExposureEntity,
  toSubjectEntity,
  toTakenAtIso
} from '@/lib/services/gallery/publicMediaDetails'
import {
  EMPTY_MEDIA_DETAILS,
  GallerySettings,
  MediaDetailsRecord
} from '@/lib/types/database/gallery'
import { getClientStatusId } from '@/lib/utils/publicId'

// The ONLY place that decides what of a gallery row leaves the server. The
// database layer decides which rows a viewer may see at all; this decides how
// much of each one they learn. Everything public goes through
// `getPublicPlace`, so the place rules (precision, snapping, hidden locations)
// are the same here, on the map and in the details endpoint.

export type GalleryProjectionViewer = 'owner' | 'public'

/** `owner` only for the owner audience; every viewer gets the public view. */
export const toGalleryProjectionViewer = (
  audience: GalleryAudience
): GalleryProjectionViewer => (audience?.kind === 'owner' ? 'owner' : 'public')

export interface GalleryItemProjectionContext {
  viewer: GalleryProjectionViewer
  settings: Pick<GallerySettings, 'showGear' | 'hiddenLocations'>
  // `id -> name` from `getGalleryGearNamesByIds`; a missing id (deleted gear)
  // projects as no gear.
  gearNames: Record<string, string>
}

/**
 * The gear ids whose names a page of rows needs: none for the public when the
 * owner hides gear, so not even a lookup depends on them.
 */
export const getGalleryGearIdsToResolve = (
  rows: GalleryMediaRow[],
  ctx: Pick<GalleryItemProjectionContext, 'viewer' | 'settings'>
): string[] => {
  if (ctx.viewer !== 'owner' && !ctx.settings.showGear) return []
  const ids = new Set<string>()
  for (const { media } of rows) {
    if (media.details?.cameraGearId) ids.add(media.details.cameraGearId)
    if (media.details?.lensGearId) ids.add(media.details.lensGearId)
  }
  return [...ids]
}

const getDetails = (row: { media: GalleryMediaRow['media'] }) => ({
  ...EMPTY_MEDIA_DETAILS,
  ...row.media.details
})

const toOwnerPlace = (
  details: MediaDetailsRecord
): GalleryItemEntity['place'] => {
  const { placeName, placePrecision, placeLatitude, placeLongitude } = details
  if (
    placeName === null &&
    placePrecision === null &&
    placeLatitude === null &&
    placeLongitude === null
  ) {
    return null
  }
  return {
    name: placeName,
    precision: placePrecision,
    latitude: placeLatitude,
    longitude: placeLongitude
  }
}

export const toGalleryItemEntity = (
  row: GalleryMediaRow,
  ctx: GalleryItemProjectionContext
): GalleryItemEntity => {
  const details = getDetails(row)
  const isOwner = ctx.viewer === 'owner'
  const showGear = isOwner || ctx.settings.showGear

  const toGear = (id: string | null) => {
    if (!showGear || !id) return null
    const name = ctx.gearNames[id]
    if (!name) return null
    // Gear ids are the owner's own bookkeeping; nobody else is ever sent one.
    return isOwner ? { id, name } : { name }
  }

  return {
    mediaId: row.media.id,
    statusId: getClientStatusId({
      id: row.statusId,
      publicId: row.statusPublicId
    }),
    attachment: row.attachment,
    subject: toSubjectEntity(details),
    takenAt: toTakenAtIso(details.takenAt),
    camera: toGear(details.cameraGearId),
    lens: toGear(details.lensGearId),
    exposure: showGear ? toExposureEntity(details.exposure) : null,
    place: isOwner
      ? toOwnerPlace(details)
      : getPublicPlace(details, {
          hiddenLocations: ctx.settings.hiddenLocations
        })
  }
}

export interface GalleryMapProjectionContext {
  viewer: GalleryProjectionViewer
  settings: Pick<GallerySettings, 'hiddenLocations'>
  /**
   * Owner only: the ids of the media a logged-out visitor can reach through a
   * public post. A map row outside it is marked `not-public-post`.
   */
  publicMediaIds?: ReadonlySet<string>
}

const mapRowDetails = (row: GalleryMapRow): MediaDetailsRecord => ({
  ...EMPTY_MEDIA_DETAILS,
  placeName: row.placeName,
  placePrecision: row.placePrecision,
  placeLatitude: row.latitude,
  placeLongitude: row.longitude
})

/**
 * A point the public map would show for this row, or null. Only `area`
 * (snapped to the grid) and `exact` precision ever appear, and only when
 * neither the stored nor the disclosed point is in a hidden location.
 * `country`, `hidden` and an unset precision never become a point.
 */
const toPublicMapLocation = (
  row: GalleryMapRow,
  settings: GalleryMapProjectionContext['settings']
): { latitude: number; longitude: number; placeName: string | null } | null => {
  if (row.placePrecision !== 'area' && row.placePrecision !== 'exact') {
    return null
  }
  const place = getPublicPlace(mapRowDetails(row), {
    hiddenLocations: settings.hiddenLocations
  })
  if (!place || place.latitude === undefined || place.longitude === undefined) {
    return null
  }
  return {
    latitude: place.latitude,
    longitude: place.longitude,
    placeName: place.name
  }
}

const getPublicState = (
  row: GalleryMapRow,
  { settings, publicMediaIds }: GalleryMapProjectionContext
): GalleryMapPublicState => {
  if (row.placePrecision !== 'area' && row.placePrecision !== 'exact') {
    return 'not-shown'
  }
  if (publicMediaIds && !publicMediaIds.has(row.id)) return 'not-public-post'
  if (!toPublicMapLocation(row, settings)) return 'in-hidden-location'
  return row.placePrecision === 'exact' ? 'shown-exact' : 'shown-area'
}

/**
 * The owner gets every stored point exactly, marked with what the public map
 * does with it. Anyone else gets `toPublicMapLocation` or nothing.
 */
export const toGalleryMapPoint = (
  row: GalleryMapRow,
  ctx: GalleryMapProjectionContext
): GalleryMapPoint | null => {
  const base = {
    mediaId: row.id,
    statusId: getClientStatusId({
      id: row.statusId,
      publicId: row.statusPublicId
    }),
    subjectName: row.subjectName,
    thumbnailUrl: row.thumbnailUrl,
    takenAt: toTakenAtIso(row.takenAt)
  }

  if (ctx.viewer === 'owner') {
    return {
      ...base,
      latitude: row.latitude,
      longitude: row.longitude,
      precision: row.placePrecision,
      publicState: getPublicState(row, ctx),
      placeName: row.placeName
    }
  }

  const location = toPublicMapLocation(row, ctx.settings)
  if (!location) return null
  return {
    ...base,
    latitude: location.latitude,
    longitude: location.longitude,
    precision: row.placePrecision,
    placeName: location.placeName
  }
}
