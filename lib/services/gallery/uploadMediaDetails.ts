import { Database } from '@/lib/database/types'
import { resolveGalleryGearFromExif } from '@/lib/services/gallery/galleryGear'
import {
  MediaExif,
  readMediaExif
} from '@/lib/services/medias/exif/readMediaExif'
import {
  DEFAULT_GALLERY_SETTINGS,
  GallerySettings,
  MediaDetailsRecord,
  MediaExposure
} from '@/lib/types/database/gallery'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/**
 * The gallery settings of an actor, defaulting on any failure. Settings tune
 * decoration on an upload (auto-describe, place precision, the gallery
 * default), so an unreadable row must not fail the upload it would only have
 * tuned.
 */
export const getGallerySettingsOrDefaults = async (
  database: Pick<Database, 'getGallerySettings'>,
  actorId: string
): Promise<GallerySettings> => {
  try {
    return await database.getGallerySettings({ actorId })
  } catch (error) {
    logger.warn({
      message: 'Failed to read gallery settings; using the defaults',
      actorId,
      err: toLoggableError(error)
    })
    return { ...DEFAULT_GALLERY_SETTINGS }
  }
}

export const toExposure = (exif: MediaExif): MediaExposure | null => {
  const exposure: MediaExposure = {
    ...(exif.focalLengthMm !== null
      ? { focalLengthMm: exif.focalLengthMm }
      : {}),
    ...(exif.aperture !== null ? { aperture: exif.aperture } : {}),
    ...(exif.exposureTime !== null ? { exposureTime: exif.exposureTime } : {}),
    ...(exif.iso !== null ? { iso: exif.iso } : {})
  }
  return Object.keys(exposure).length > 0 ? exposure : null
}

/**
 * The details a freshly uploaded media row starts with.
 *
 * `original` is the ORIGINAL upload (EXIF is gone from the stored copy, see
 * `readMediaExif`); null for media with no readable EXIF — videos, today —
 * which still gets `inGallery` from the owner's `galleryDefault`.
 *
 * - Gear is resolved by `deviceKey` (created if missing, never mutated).
 * - GPS becomes the place, at the owner's `defaultPlacePrecision`. Exact
 *   coordinates are stored but only ever sent to the owner.
 * - `inGallery`: `always` -> true, `never` and `subject` -> false. `subject`
 *   flips to true when a subject is set (see the media update route).
 *
 * Never throws.
 */
export const buildUploadMediaDetails = async ({
  database,
  actorId,
  original
}: {
  database: Database
  actorId: string
  original: Buffer | null
}): Promise<Partial<MediaDetailsRecord>> => {
  const settings = await getGallerySettingsOrDefaults(database, actorId)
  const inGallery = settings.galleryDefault === 'always'
  if (!original) return { inGallery }

  try {
    const exif = await readMediaExif(original)
    const { cameraGearId, lensGearId } = await resolveGalleryGearFromExif({
      database,
      actorId,
      exif
    })
    const hasPlace = exif.latitude !== null && exif.longitude !== null

    return {
      inGallery,
      ...(exif.takenAt ? { takenAt: exif.takenAt.getTime() } : {}),
      ...(cameraGearId ? { cameraGearId } : {}),
      ...(lensGearId ? { lensGearId } : {}),
      ...(toExposure(exif) ? { exposure: toExposure(exif) } : {}),
      ...(hasPlace
        ? {
            placeLatitude: exif.latitude,
            placeLongitude: exif.longitude,
            placePrecision: settings.defaultPlacePrecision
          }
        : {})
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to build the details of an uploaded media file',
      actorId,
      err: toLoggableError(error)
    })
    return { inGallery }
  }
}
