import { Database } from '@/lib/database/types'
import { getSubjectThreatStatus } from '@/lib/services/gallery/threatenedSpecies'
import { getMediaAttachment } from '@/lib/services/medias/getMediaAttachment'
import {
  MediaDetailsEntity,
  MediaStorageSaveFileOutput
} from '@/lib/services/medias/types'
import { EMPTY_MEDIA_DETAILS } from '@/lib/types/database/gallery'
import { Media } from '@/lib/types/database/operations'

/**
 * How long a subject or place lookup may stay `pending` before the owner is
 * offered a Retry: a job lost to a queue outage, or one the queue dropped,
 * would otherwise leave "Checking IUCN status…" (or "Looking up the place
 * name…") up for good.
 */
export const STALE_SUBJECT_LOOKUP_MS = 2 * 60 * 1000

const isStalePending = (
  status: string | null,
  lookupAt: number | null,
  now: number
) =>
  status === 'pending' &&
  (lookupAt === null || now - lookupAt >= STALE_SUBJECT_LOOKUP_MS)

/**
 * The `details` extension for the media's OWNER, with exact stored
 * coordinates, the IUCN category, both lookup statuses and the model's subject
 * suggestions — none of which anyone else is ever sent.
 * Gear names are looked up in one query; a gear row that has since been
 * deleted reads as no gear.
 */
export const buildOwnerMediaDetails = async (
  database: Pick<Database, 'getGalleryGearNamesByIds'>,
  media: Media
): Promise<MediaDetailsEntity> => {
  // A Media built by hand (tests, fixtures) may carry only some of the fields.
  const details = { ...EMPTY_MEDIA_DETAILS, ...media.details }

  const gearIds = [details.cameraGearId, details.lensGearId].filter(
    (id): id is string => Boolean(id)
  )
  const names =
    gearIds.length > 0
      ? await database.getGalleryGearNamesByIds({ ids: gearIds })
      : {}
  const toGear = (id: string | null) =>
    id && names[id] ? { id, name: names[id] } : null

  const exposure = details.exposure
  const hasPlace =
    details.placeName !== null ||
    details.placeLatitude !== null ||
    details.placeLongitude !== null ||
    details.placePrecision !== null

  return {
    subject:
      details.subjectName ||
      details.subjectScientificName ||
      details.subjectCategory
        ? {
            name: details.subjectName,
            scientificName: details.subjectScientificName,
            category: details.subjectCategory,
            taxonKey: details.subjectTaxonKey,
            taxonPath: details.subjectTaxonPath,
            iucnCategory: details.subjectIucnCategory,
            threatStatus: getSubjectThreatStatus(details),
            lookupStatus: details.subjectLookupStatus,
            lookupStale: isStalePending(
              details.subjectLookupStatus,
              details.subjectLookupAt,
              Date.now()
            )
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
    place: hasPlace
      ? {
          name: details.placeName,
          latitude: details.placeLatitude,
          longitude: details.placeLongitude,
          precision: details.placePrecision,
          countryCode: details.placeCountryCode,
          nameSource: details.placeNameSource,
          lookupStatus: details.placeLookupStatus,
          lookupStale: isStalePending(
            details.placeLookupStatus,
            details.placeLookupAt,
            Date.now()
          )
        }
      : null,
    subjectSuggestions: details.subjectSuggestions,
    inGallery: details.inGallery
  }
}

/**
 * The media entity an owner gets back from the media endpoints: the Mastodon
 * `MediaAttachment` plus the `details` extension. Only call this for the
 * media's owner.
 */
export const getOwnerMediaAttachment = async (
  database: Pick<Database, 'getGalleryGearNamesByIds'>,
  media: Media,
  host: string
): Promise<MediaStorageSaveFileOutput> =>
  getMediaAttachment(media, host, {
    details: await buildOwnerMediaDetails(database, media)
  })
