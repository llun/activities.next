import { Database } from '@/lib/database/types'
import { MediaPublicDetails } from '@/lib/services/gallery/galleryEntities'
import { isInGalleryHiddenLocation } from '@/lib/services/gallery/hiddenLocations'
import {
  EMPTY_MEDIA_DETAILS,
  GalleryHiddenLocation,
  GallerySettings,
  MediaDetailsRecord,
  MediaExposure
} from '@/lib/types/database/gallery'
import { Media } from '@/lib/types/database/operations'

// An `area` place is snapped to a 0.05 degree grid: about 5.5 km north-south
// everywhere, and about 5.5 km east-west at the equator, narrowing towards the
// poles. The cell centre, not the true point, is what is disclosed.
export const AREA_PRECISION_DEGREES = 0.05

export const snapToGrid = (value: number): number => {
  const snapped =
    Math.round(value / AREA_PRECISION_DEGREES) * AREA_PRECISION_DEGREES
  // 0.05 steps accumulate float noise (51.550000000000004); two decimals is the
  // grid's own resolution.
  return Number((snapped === 0 ? 0 : snapped).toFixed(2))
}

export type PublicPlace = NonNullable<MediaPublicDetails['place']>

/**
 * The place a viewer other than the owner is shown. The stored coordinates are
 * never returned as they are unless the owner chose `exact`.
 *
 * Null — no name, no precision, nothing — when the precision is `hidden`, when
 * there is neither a precision nor a name, or when the place falls inside one
 * of the owner's hidden locations. That last test runs on the stored point AND
 * on the point that would be disclosed: an `area` cell centre can land inside
 * a zone the true point is just outside of, and publishing that centre would
 * put a pin in the very place the owner hid. It applies whatever the
 * precision, so a `country` name is withheld too. `hiddenLocations` is
 * required so no caller can forget the zones.
 */
export const getPublicPlace = (
  details: Media['details'],
  { hiddenLocations }: { hiddenLocations: readonly GalleryHiddenLocation[] }
): PublicPlace | null => {
  const { placeName, placePrecision, placeLatitude, placeLongitude } = {
    ...EMPTY_MEDIA_DETAILS,
    ...details
  }

  if (placePrecision === 'hidden') return null
  if (placeName === null && placePrecision === null) return null

  const place: NonNullable<MediaPublicDetails['place']> = {
    name: placeName,
    precision: placePrecision
  }
  const hasCoordinates = placeLatitude !== null && placeLongitude !== null
  if (hasCoordinates && placePrecision === 'exact') {
    place.latitude = placeLatitude
    place.longitude = placeLongitude
  } else if (hasCoordinates && placePrecision === 'area') {
    place.latitude = snapToGrid(placeLatitude)
    place.longitude = snapToGrid(placeLongitude)
  }

  if (hiddenLocations.length > 0) {
    if (
      hasCoordinates &&
      isInGalleryHiddenLocation(placeLatitude, placeLongitude, hiddenLocations)
    ) {
      return null
    }
    if (
      place.latitude !== undefined &&
      place.longitude !== undefined &&
      isInGalleryHiddenLocation(
        place.latitude,
        place.longitude,
        hiddenLocations
      )
    ) {
      return null
    }
  }
  return place
}

/** The subject block, or null when the media names nothing at all. */
export const toSubjectEntity = (
  details: Pick<
    MediaDetailsRecord,
    'subjectName' | 'subjectScientificName' | 'subjectCategory'
  >
): MediaPublicDetails['subject'] =>
  details.subjectName ||
  details.subjectScientificName ||
  details.subjectCategory
    ? {
        name: details.subjectName,
        scientificName: details.subjectScientificName,
        category: details.subjectCategory
      }
    : null

export const toTakenAtIso = (takenAt: number | null): string | null =>
  takenAt === null ? null : new Date(takenAt).toISOString()

export const toExposureEntity = (
  exposure: MediaExposure | null
): MediaPublicDetails['exposure'] =>
  exposure
    ? {
        focalLengthMm: exposure.focalLengthMm ?? null,
        aperture: exposure.aperture ?? null,
        exposureTime: exposure.exposureTime ?? null,
        iso: exposure.iso ?? null
      }
    : null

/**
 * The public-safe projection of a media's details. Visibility of the media
 * itself (that it hangs off a status the viewer may read) is the caller's
 * business; this decides only what of the details may leave.
 */
export const buildPublicMediaDetails = async ({
  database,
  media,
  settings
}: {
  database: Pick<Database, 'getGalleryGearNamesByIds'>
  media: Media
  settings: Pick<GallerySettings, 'showGear' | 'hiddenLocations'>
}): Promise<MediaPublicDetails> => {
  const details = { ...EMPTY_MEDIA_DETAILS, ...media.details }

  const gearIds = settings.showGear
    ? [details.cameraGearId, details.lensGearId].filter((id): id is string =>
        Boolean(id)
      )
    : []
  const names =
    gearIds.length > 0
      ? await database.getGalleryGearNamesByIds({ ids: gearIds })
      : {}
  const toGear = (id: string | null) =>
    id && names[id] ? { name: names[id] } : null

  const exposure = settings.showGear ? details.exposure : null

  return {
    subject: toSubjectEntity(details),
    takenAt: toTakenAtIso(details.takenAt),
    camera: toGear(details.cameraGearId),
    lens: toGear(details.lensGearId),
    exposure: toExposureEntity(exposure),
    place: getPublicPlace(details, {
      hiddenLocations: settings.hiddenLocations
    })
  }
}
