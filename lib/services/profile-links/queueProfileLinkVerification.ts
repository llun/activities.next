import { VERIFY_PROFILE_LINKS_JOB_NAME } from '@/lib/jobs/names'
import { getVerifiableFieldUrl } from '@/lib/services/profile-links/html'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import {
  carryOverFieldVerification,
  profileFieldValuesChanged
} from '@/lib/utils/profileFieldVerification'
import { toLoggableError } from '@/lib/utils/toLoggableError'

type FieldLike = { name?: string; value: string; verifiedAt?: number | null }

// Two queues of the same state within this window collapse into one job. The
// database queue keeps finished jobs and ignores a new job under a taken id,
// so the id cannot be the state alone: saving the same unverified value again
// after adding the rel="me" link must run again. A check takes a few seconds
// (up to about 30 s per link), so a short window covers concurrent queues.
const DEDUPE_WINDOW_MS = 30_000

// Render-path bounds (a remote profile view), measured from `linksCheckedAt`,
// which the job stamps on every run. A changed value is checked again after an
// hour: soon enough that a real edit is picked up, rare enough that a remote
// serving different values on every fetch cannot make each render fetch up to
// four sites. An unchanged unverified value waits as long as the remote actor
// refresh does (3 days), the cadence at which the owner could have added the
// link back.
export const RENDER_CHANGED_RECHECK_MS = 3_600_000
export const RENDER_UNVERIFIED_RECHECK_MS = 3 * 86_400_000

/**
 * Queue the rel="me" check of an actor's profile links when the field values
 * changed or any field is verifiable but not yet verified (a changed
 * verifiable value is always unverified, so the second test covers both), as
 * Mastodon's `check_links` does (`requires_verification?`): the owner may have
 * added the link back to their site since the last check. `before` is
 * undefined for an actor that was just created. Nothing is queued for an empty list or one with
 * nothing verifiable, and a refresh that changed nothing on a profile whose
 * links are all verified (or not verifiable) sends no request.
 *
 * `renderCheckedAt` marks a path that runs on every page render (a remote
 * profile view) and must not fetch the linked sites each time: it passes the
 * actor's `linksCheckedAt` (or null when never checked), and nothing is queued
 * while that is newer than `RENDER_CHANGED_RECHECK_MS` (changed values) or
 * `RENDER_UNVERIFIED_RECHECK_MS` (unchanged unverified values). Leave it
 * undefined for the local save paths and real refreshes, which always queue.
 *
 * `remote` says how a value reads: a local actor's is the raw text the owner
 * typed, a remote actor's is the HTML its server sent. `after` is the incoming
 * list; a field whose value equals a stored one in `before` counts as verified
 * when that stored one is (the same carry-over the write applies).
 *
 * Best effort, like publishActorUpdate: the profile is already saved, so a
 * queue failure is logged instead of failing the request that saved it.
 */
export const queueProfileLinkVerification = async ({
  actorId,
  before,
  after,
  remote,
  renderCheckedAt
}: {
  actorId: string
  before: FieldLike[] | undefined
  after: FieldLike[]
  remote: boolean
  renderCheckedAt?: number | null
}): Promise<void> => {
  if (after.length === 0) return
  const effective = carryOverFieldVerification(
    after.map((field) => ({ name: field.name ?? '', value: field.value })),
    before?.flatMap((field) =>
      field.verifiedAt
        ? [
            {
              name: field.name ?? '',
              value: field.value,
              verifiedAt: field.verifiedAt
            }
          ]
        : []
    )
  )
  const needsCheck = effective.some(
    (field) =>
      !field.verifiedAt &&
      getVerifiableFieldUrl(field.value, { remote }) !== null
  )
  if (!needsCheck) return
  if (renderCheckedAt !== undefined && renderCheckedAt !== null) {
    const interval = profileFieldValuesChanged(before, after)
      ? RENDER_CHANGED_RECHECK_MS
      : RENDER_UNVERIFIED_RECHECK_MS
    if (Date.now() - renderCheckedAt < interval) return
  }

  const stateHash = getHashFromString(
    JSON.stringify(after.map((field) => field.value).sort())
  ).slice(0, 16)
  const window = Math.floor(Date.now() / DEDUPE_WINDOW_MS)
  try {
    // Loaded here, not at the top: `recordActorIfNeeded` (lib/actions/utils)
    // calls this, and the queue module reaches every job, including the ones
    // that import `lib/actions/utils` back. A static import closes that cycle
    // and changes which copy of `recordActorIfNeeded` the jobs receive.
    const { getQueue } = await import('@/lib/services/queue')
    await getQueue().publish({
      id: getHashFromString(
        `${actorId}#verify-profile-links/${stateHash}/${window}`
      ),
      name: VERIFY_PROFILE_LINKS_JOB_NAME,
      data: { actorId }
    })
  } catch (error) {
    logger.error({
      message: 'Failed to queue the profile link verification',
      actorId,
      err: toLoggableError(error)
    })
  }
}
