import { randomUUID } from 'node:crypto'

import {
  RESOLVE_MEDIA_PLACE_JOB_NAME,
  RESOLVE_MEDIA_SUBJECT_JOB_NAME
} from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// What decides whether two publishes are the same work.
//
// A publish without `fresh` gets an id derived only from the media and these
// inputs, so a redelivered or doubled publish of the SAME event (an upload's
// verify step running twice) collapses into one job.
//
// Every publish that follows a reset of the lookup state (an edit) or that the
// owner asked for (Retry) passes `fresh`, which adds a random part. Without it
// an edit back to an earlier subject or point (A, then B, then A) would reuse
// the first job's id: the database queue keeps finished jobs for days and
// ignores a new one under a taken id, and QStash deduplicates the same way,
// so the reset status would stay `pending` (or null) with nothing to run it.
interface FreshnessParams {
  fresh?: boolean
  // The owner's Retry: the job asks the provider again instead of answering a
  // failure the lookup cache remembers.
  retry?: boolean
}

export interface PublishPlaceLookupParams extends FreshnessParams {
  mediaId: string
  latitude: number
  longitude: number
}

export interface PublishSubjectLookupParams extends FreshnessParams {
  mediaId: string
  subjectName: string | null
  subjectScientificName: string | null
  subjectCategory: string | null
  subjectTaxonKey: string | null
}

const freshSuffix = (fresh: boolean | undefined) =>
  fresh ? `:${randomUUID()}` : ''

const jobData = (mediaId: string, retry: boolean | undefined) =>
  retry ? { mediaId, retry: true } : { mediaId }

// Publishing never fails the request that triggered it: the upload or update
// has already committed, and a lookup only decorates it. A queue failure is
// logged and the media simply stays unchecked until the owner retries.
export const publishPlaceLookup = async ({
  mediaId,
  latitude,
  longitude,
  fresh,
  retry
}: PublishPlaceLookupParams): Promise<boolean> => {
  try {
    await getQueue().publish({
      id: getHashFromString(
        `${mediaId}:place-lookup:${latitude},${longitude}${freshSuffix(fresh)}`
      ),
      name: RESOLVE_MEDIA_PLACE_JOB_NAME,
      data: jobData(mediaId, retry)
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
  fresh,
  retry
}: PublishSubjectLookupParams): Promise<boolean> => {
  try {
    await getQueue().publish({
      id: getHashFromString(
        `${mediaId}:subject-lookup:${JSON.stringify([
          subjectName,
          subjectScientificName,
          subjectCategory,
          subjectTaxonKey
        ])}${freshSuffix(fresh)}`
      ),
      name: RESOLVE_MEDIA_SUBJECT_JOB_NAME,
      data: jobData(mediaId, retry)
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
