import {
  RESOLVE_MEDIA_PLACE_JOB_NAME,
  RESOLVE_MEDIA_SUBJECT_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// What decides whether two publishes are the same work. Job ids are
// deterministic over the media and these inputs, so a redelivered or doubled
// publish collapses into one job, while a changed subject or place gets its own.
export interface PublishPlaceLookupParams {
  mediaId: string
  latitude: number
  longitude: number
  // Run again even if the same inputs already ran (the owner's Retry).
  force?: boolean
}

export interface PublishSubjectLookupParams {
  mediaId: string
  subjectName: string | null
  subjectScientificName: string | null
  subjectCategory: string | null
  subjectTaxonKey: string | null
  force?: boolean
}

// Publishing never fails the request that triggered it: the upload or update
// has already committed, and a lookup only decorates it. A queue failure is
// logged and the media simply stays unchecked until the owner retries.
export const publishPlaceLookup = async ({
  mediaId,
  latitude,
  longitude,
  force
}: PublishPlaceLookupParams): Promise<boolean> => {
  try {
    await getQueue().publish({
      id: getHashFromString(
        `${mediaId}:place-lookup:${latitude},${longitude}${
          force ? `:${Date.now()}` : ''
        }`
      ),
      name: RESOLVE_MEDIA_PLACE_JOB_NAME,
      data: { mediaId }
    })
    return true
  } catch (error) {
    logger.warn({
      message: 'Failed to publish the place lookup for a media',
      mediaId,
      err: toLoggableError(error)
    })
    return false
  }
}

export const publishSubjectLookup = async ({
  mediaId,
  subjectName,
  subjectScientificName,
  subjectCategory,
  subjectTaxonKey,
  force
}: PublishSubjectLookupParams): Promise<boolean> => {
  try {
    await getQueue().publish({
      id: getHashFromString(
        `${mediaId}:subject-lookup:${JSON.stringify([
          subjectName,
          subjectScientificName,
          subjectCategory,
          subjectTaxonKey
        ])}${force ? `:${Date.now()}` : ''}`
      ),
      name: RESOLVE_MEDIA_SUBJECT_JOB_NAME,
      data: { mediaId }
    })
    return true
  } catch (error) {
    logger.warn({
      message: 'Failed to publish the subject lookup for a media',
      mediaId,
      err: toLoggableError(error)
    })
    return false
  }
}
