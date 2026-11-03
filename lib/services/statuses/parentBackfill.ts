import { Database } from '@/lib/database/types'
import { FETCH_REMOTE_STATUS_JOB_NAME } from '@/lib/jobs/names'
import { isLocalDomain } from '@/lib/services/domains/localDomains'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { getQueue } from '@/lib/services/queue'
import { normalizeActivityPubUri } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// Thread backfill: when a stored status replies to a parent this instance does
// not have, queue one FetchRemoteStatusJob (`ancestorsOnly`) for that parent,
// which stores it and walks on up its chain (Mastodon's ThreadResolveWorker).
//
// A parent is queued at most once per PARENT_FETCH_COOLDOWN_MS, so a burst of
// replies to one missing parent, or repeated views of its thread, cost one
// fetch:
// - in this process, a map of the parents queued in the window (bounded to
//   MAX_TRACKED_PARENTS, oldest dropped first), which also covers the queues
//   that do not deduplicate by id (the in-process NoQueue, Cloud Tasks);
// - across processes, the job id: the parent's hash plus the window number,
//   which the database queue and QStash deduplicate on, and which changes once
//   the window passes so a parent that could not be fetched is tried again.
export const PARENT_FETCH_COOLDOWN_MS = 10 * 60 * 1000
const MAX_TRACKED_PARENTS = 10_000

const queuedParentsAt = new Map<string, number>()

// Test-only: the cooldown map is module state shared by every test in a file.
export const resetParentBackfillStateForTesting = () => {
  queuedParentsAt.clear()
}

export const getParentFetchJobId = (parentId: string, now: number) =>
  `fetch-remote-status-parent-${getHashFromString(parentId)}-${Math.floor(
    now / PARENT_FETCH_COOLDOWN_MS
  )}`

const isInCooldown = (key: string, now: number) => {
  const queuedAt = queuedParentsAt.get(key)
  return queuedAt !== undefined && now - queuedAt < PARENT_FETCH_COOLDOWN_MS
}

const markQueued = (key: string, now: number) => {
  // Re-inserting keeps the map in queued order, so the first key is the
  // oldest one to drop when the map is full.
  queuedParentsAt.delete(key)
  if (queuedParentsAt.size >= MAX_TRACKED_PARENTS) {
    const oldest = queuedParentsAt.keys().next().value
    if (oldest !== undefined) queuedParentsAt.delete(oldest)
  }
  queuedParentsAt.set(key, now)
}

const isStored = async (database: Database, reference: string) =>
  Boolean(
    (await database.getStatus({ statusId: reference, withReplies: false })) ??
    (await database.getStatusFromUrl({ url: reference }))
  )

/**
 * Queues the fetch of the parent a reply names in `inReplyTo` when it is not
 * stored. Nothing is queued for an empty or non-HTTPS reference, a parent on
 * a domain this server serves (a missing local parent was deleted), one on a
 * blocked or suspended domain or outside the allow-list, one already stored,
 * or one queued within the cooldown. Returns whether a job was published.
 *
 * `detachInline`: under the in-process NoQueue, `publish` runs the job before
 * it returns. A caller that should not wait for it (a page or API read) passes
 * true to let the job finish after it answers; a job that queues the fetch
 * (createNoteJob) leaves it false, as its other inline work does. The inline
 * run fetches at most INLINE_MAX_ANCESTOR_FETCHES parents either way.
 */
export const queueMissingParentFetch = async ({
  database,
  inReplyTo,
  detachInline = false
}: {
  database: Database
  inReplyTo: string | null | undefined
  detachInline?: boolean
}): Promise<boolean> => {
  if (!inReplyTo) return false
  let url: URL
  try {
    url = new URL(inReplyTo)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false

  const key = normalizeActivityPubUri(inReplyTo) ?? inReplyTo
  if (isInCooldown(key, Date.now())) return false

  try {
    if (await isLocalDomain(database, inReplyTo)) return false
    if (!(await canFederateWithDomain(database, inReplyTo))) return false
    if (await isStored(database, inReplyTo)) return false
  } catch (err) {
    logger.warn({
      message: 'Failed to check a missing parent status for backfill',
      inReplyTo,
      err: toLoggableError(err)
    })
    return false
  }

  const now = Date.now()
  // Re-checked after the awaits above: a concurrent call may have queued it.
  if (isInCooldown(key, now)) return false
  markQueued(key, now)

  const queue = getQueue()
  const publish = (async () => {
    await queue.publish({
      id: getParentFetchJobId(key, now),
      name: FETCH_REMOTE_STATUS_JOB_NAME,
      data: {
        statusId: inReplyTo,
        ancestorsOnly: true,
        firstPageOnly: queue.runsInline
      }
    })
    return true
  })().catch((err) => {
    // A queue that refused the job lets the next reply or view try again
    // rather than wait out the window. Under NoQueue the job itself ran and
    // failed, so the parent keeps its cooldown.
    if (!queue.runsInline) queuedParentsAt.delete(key)
    logger.error({
      message: 'Failed to queue missing parent status fetch',
      inReplyTo,
      err: toLoggableError(err)
    })
    return false
  })
  if (detachInline && queue.runsInline) {
    void publish
    return true
  }
  return publish
}

/**
 * The thread backfill for a context read: queues the parent the read's
 * ancestor walk stopped at because nothing is stored for it
 * (`getStatusContext`'s `missingParentId`, taken before visibility filtering,
 * so a gap above an ancestor the viewer cannot see is found too). The fetch
 * job walks on above it. Never waits for an in-process run.
 */
export const queueThreadGapBackfill = ({
  database,
  missingParentId
}: {
  database: Database
  missingParentId: string
}): Promise<boolean> =>
  queueMissingParentFetch({
    database,
    inReplyTo: missingParentId,
    detachInline: true
  })
