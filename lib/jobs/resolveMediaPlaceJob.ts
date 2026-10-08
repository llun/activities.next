import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { RESOLVE_MEDIA_PLACE_JOB_NAME } from '@/lib/jobs/names'
import { createNominatimClient } from '@/lib/services/gallery/lookups/nominatim'
import { JobHandle } from '@/lib/services/queue/type'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

const ResolveMediaPlaceJobData = z.object({
  mediaId: z.string().min(1),
  // The owner's Retry (and the backfill): remembered provider failures, and
  // a remembered cell with no name, are asked again.
  retry: z.boolean().optional()
})

/**
 * Reverse-geocode a media's coordinates into a place name and country code.
 *
 * Only the centre of the 0.05 degree cell the point is in is sent to
 * Nominatim (the client snaps it), never the stored point, and it runs for
 * every photo with coordinates, whatever the public precision, so the owner
 * can be offered a name.
 *
 * The write is a compare-and-set on the coordinates that were read, so a move
 * made meanwhile wins. The name only fills a place the owner has not named
 * (an owner-typed name is never overwritten); the country code always lands.
 *
 * Provider errors are caught and recorded as `failed`; the job returns
 * normally, so a rate-limited free service is not retried into the ground.
 */
export const resolveMediaPlaceJob: JobHandle = createJobHandle(
  RESOLVE_MEDIA_PLACE_JOB_NAME,
  async (database, message) => {
    const parsed = ResolveMediaPlaceJobData.safeParse(message.data)
    if (!parsed.success) return

    const { mediaId, retry = false } = parsed.data
    const found = await database.getMediaWithAttachedStatusIds({ mediaId })
    const details: Partial<MediaDetailsRecord> | undefined =
      found?.media.details
    const latitude = details?.placeLatitude
    const longitude = details?.placeLongitude
    if (
      !details ||
      latitude === null ||
      latitude === undefined ||
      longitude === null ||
      longitude === undefined
    ) {
      return
    }

    const expect = { placeLatitude: latitude, placeLongitude: longitude }
    const write = async (
      patch: Parameters<typeof database.setMediaPlaceLookup>[0]['patch']
    ) => {
      const applied = await database.setMediaPlaceLookup({
        mediaId,
        expect,
        patch
      })
      if (!applied) {
        logger.debug({
          message: 'Place lookup result dropped: the coordinates changed',
          mediaId
        })
      }
    }

    // Re-checked at run time, see resolveMediaSubjectJob.
    const { network } = await getResolvedServerSettings(database)
    if (!network.placeLookups) {
      // A result already stored for these coordinates (a move resets the
      // status) stays valid, with its country code; only an unchecked place
      // is marked, as the subject job does.
      const status = details.placeLookupStatus ?? null
      if (status !== 'resolved' && status !== 'no-match') {
        await write({ placeLookupStatus: 'disabled' })
      }
      return
    }

    try {
      const place = await createNominatimClient({
        database,
        skipCachedErrors: retry,
        skipCachedMiss: retry
      }).reverseGeocode({
        latitude,
        longitude
      })

      if (!place) {
        await write({ placeCountryCode: null, placeLookupStatus: 'no-match' })
        return
      }

      const mayNamePlace =
        (details.placeName ?? null) === null ||
        details.placeNameSource === 'geocoder'
      await write({
        ...(mayNamePlace && place.name !== null
          ? { placeName: place.name }
          : {}),
        placeCountryCode: place.countryCode,
        placeLookupStatus: 'resolved'
      })
    } catch (error) {
      logger.warn({
        message: 'Failed to resolve the place of a media',
        mediaId,
        err: toLoggableError(error)
      })
      try {
        await write({ placeLookupStatus: 'failed' })
      } catch (writeError) {
        logger.warn({
          message: 'Failed to record the failed place lookup',
          mediaId,
          err: toLoggableError(writeError)
        })
      }
    }
  }
)
