import { Database } from '@/lib/database/types'
import { MediaPublicDetails } from '@/lib/services/gallery/galleryEntities'
import {
  EMPTY_MEDIA_DETAILS,
  GallerySettings
} from '@/lib/types/database/gallery'
import { Media } from '@/lib/types/database/operations'

// An `area` place is snapped to a 0.05 degree grid: about 5.5 km north-south
// everywhere, and about 5.5 km east-west at the equator, narrowing towards the
// poles. The cell centre, not the true point, is what is disclosed.
export const AREA_PRECISION_DEGREES = 0.05

const snapToGrid = (value: number): number => {
  const snapped =
    Math.round(value / AREA_PRECISION_DEGREES) * AREA_PRECISION_DEGREES
  // 0.05 steps accumulate float noise (51.550000000000004); two decimals is the
  // grid's own resolution.
  return Number((snapped === 0 ? 0 : snapped).toFixed(2))
}

/**
 * The place a viewer other than the owner is shown. The stored coordinates are
 * never returned as they are unless the owner chose `exact`.
 */
export const getPublicPlace = (
  details: Media['details']
): MediaPublicDetails['place'] => {
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
  return place
}

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
  settings: Pick<GallerySettings, 'showGear'>
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
    subject:
      details.subjectName ||
      details.subjectScientificName ||
      details.subjectCategory
        ? {
            name: details.subjectName,
            scientificName: details.subjectScientificName,
            category: details.subjectCategory
          }
        : null,
    takenAt:
      details.takenAt === null ? null : new Date(details.takenAt).toISOString(),
    camera: toGear(details.cameraGearId),
    lens: toGear(details.lensGearId),
    exposure: exposure
      ? {
          focalLengthMm: exposure.focalLengthMm ?? null,
          aperture: exposure.aperture ?? null,
          exposureTime: exposure.exposureTime ?? null,
          iso: exposure.iso ?? null
        }
      : null,
    place: getPublicPlace(details)
  }
}
