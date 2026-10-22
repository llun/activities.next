// The send queue: drains drafts the user chose to "Send when online". Only
// type imports from the API modules, so loading this file pulls in no fetch
// code; the real dependencies are passed in as `deps` (defaults live with the
// provider, from sub-path imports, never the `@/lib/client` barrel).
//
// Exactly once: the claim and every write are revision-checked in draftsDb,
// and the Idempotency-Key is persisted (`submit`) before every POST, so a
// retry, another tab or a composer only ever replays the same key.
import type { reportRequestFailure } from '@/lib/client/connection'
import type { uploadFitnessFile } from '@/lib/client/fitnessImports'
import type { deleteUnpostedFitnessFile } from '@/lib/client/fitnessRoutes'
import type { getGallerySettings } from '@/lib/client/gallery'
import {
  ApiRequestError,
  classifyFailedPost,
  isPostKeptByServer
} from '@/lib/client/http'
import type { deleteUnpostedMedia, uploadAttachment } from '@/lib/client/media'
import type {
  createNote,
  createPoll,
  getStatusIfReadable
} from '@/lib/client/statuses'
import { EXPECTED_ACTOR_MISMATCH_ERROR } from '@/lib/services/statuses/expectedActor'
import { generatePublicId } from '@/lib/utils/publicId'

import { blobRecordToFile, blobRecordToPosterFile } from './draftMedia'
import {
  type claimQueuedDraft,
  type deleteDraftIfRevision,
  type getDraftBlob,
  isQueueClaimable,
  type listDrafts,
  type renewClaim,
  type updateQueuedDraft
} from './draftsDb'
import {
  CHECKING_GIVE_UP_MS,
  CLAIM_LEASE_MS,
  DEFAULT_RETRY_AFTER_MS,
  MAX_QUEUE_AGE_MS,
  SEND_BACKOFF_MS,
  SEND_TIMEOUT_MS,
  holdsQueue,
  pausedByReader,
  retriesOnItsOwn
} from './queueConstants'
import { buildSubmitRequest } from './submitRequest'
import type {
  DraftQueuePause,
  DraftQueueState,
  DraftRecord,
  SendQueueProgress
} from './types'

// Re-exported so `@/lib/client/drafts` keeps exposing the timing.
export * from './queueConstants'

export interface SendQueueDeps {
  listDrafts: typeof listDrafts
  claimQueuedDraft: typeof claimQueuedDraft
  updateQueuedDraft: typeof updateQueuedDraft
  renewClaim: typeof renewClaim
  deleteDraftIfRevision: typeof deleteDraftIfRevision
  getDraftBlob: typeof getDraftBlob
  createNote: typeof createNote
  createPoll: typeof createPoll
  getStatusIfReadable: typeof getStatusIfReadable
  getGallerySettings: typeof getGallerySettings
  uploadAttachment: typeof uploadAttachment
  uploadFitnessFile: typeof uploadFitnessFile
  deleteUnpostedMedia: typeof deleteUnpostedMedia
  deleteUnpostedFitnessFile: typeof deleteUnpostedFitnessFile
  isOnline: () => boolean
  reportRequestFailure: typeof reportRequestFailure
  /** Broadcasts `changed` for the draft. */
  announce: (draftId: string) => void
  now: () => number
}

/** How one send attempt ended; `drainQueue` turns it into a queue write. */
export type Outcome =
  | { kind: 'sent' }
  /** Nothing was sent (pre-flight or upload failed): try again later. */
  | { kind: 'waiting'; nextAttemptAt: number }
  /** A POST may have landed: only the same key is sent again. */
  | { kind: 'checking'; nextAttemptAt: number; lockedMessage?: string }
  | { kind: 'needs_review'; reason: string; clearSubmit?: boolean }
  /** `lockedMessage`: the server may hold the post; reopen it locked. */
  | { kind: 'couldnt_send'; reason: string; lockedMessage?: string }
  | {
      kind: 'paused'
      pausedBy: DraftQueuePause
      reason: string
      nextAttemptAt?: number
    }

export interface DrainResult {
  /** Items this drain claimed. */
  attempted: number
  sent: number
  needsReview: number
  failed: number
  paused: number
}

export interface DrainOptions {
  accountId: string
  actorId: string
  epoch: number
  tabId: string
  signal: AbortSignal
  deps: SendQueueDeps
  onProgress: (progress: SendQueueProgress) => void
}

export const backoff = (attempt: number): number =>
  SEND_BACKOFF_MS[Math.min(Math.max(attempt, 0), SEND_BACKOFF_MS.length - 1)]

const isAbortLike = (error: unknown): boolean => {
  const name = (error as { name?: unknown } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

const wayOut = (draft: DraftRecord) =>
  draft.composer === 'reply-box' ? 'cancel the reply' : 'discard the draft'

const lockMessage = (
  error: unknown,
  draft: DraftRecord,
  retryingLocked = !!draft.lockedMessage
): string =>
  classifyFailedPost(error, {
    retryingLocked,
    fallbackMessage: 'Fail to create a post',
    wayOut: wayOut(draft)
  }).message

/**
 * Turns a failed pre-flight, upload or POST into a queue outcome; the checks
 * run in order, so the first match wins. `preflight`: nothing was POSTed in
 * this attempt. `now` is read when the failure is classified, so a backoff
 * never starts already in the past.
 */
export const classifySendOutcome = (
  error: unknown,
  draft: DraftRecord,
  { now, preflight = false }: { now: number; preflight?: boolean }
): Outcome => {
  const attempts = draft.queue?.attempts ?? 0
  const status = error instanceof ApiRequestError ? error.status : undefined
  // Before anything that reads 409 as "kept".
  if (
    status === 409 &&
    (error as Error).message === EXPECTED_ACTOR_MISMATCH_ERROR
  ) {
    return {
      kind: 'paused',
      pausedBy: 'actor',
      reason: EXPECTED_ACTOR_MISMATCH_ERROR
    }
  }
  if (status === 401) {
    return {
      kind: 'paused',
      pausedBy: 'auth',
      reason: 'Sign in again to send it'
    }
  }
  if (status === 429) {
    const retryAfterMs = (error as ApiRequestError).retryAfterMs
    return {
      kind: 'paused',
      pausedBy: 'rate_limit',
      reason: 'Too many posts. Trying again soon.',
      nextAttemptAt: now + (retryAfterMs ?? DEFAULT_RETRY_AFTER_MS)
    }
  }
  const networkLike =
    error instanceof TypeError ||
    isAbortLike(error) ||
    (status !== undefined && status >= 500)
  if (preflight && networkLike) {
    return { kind: 'waiting', nextAttemptAt: now + backoff(attempts) }
  }
  if (networkLike || status === 409) {
    return {
      kind: 'checking',
      nextAttemptAt: now + backoff(attempts - 1),
      ...(isPostKeptByServer(error)
        ? { lockedMessage: lockMessage(error, draft) }
        : {})
    }
  }
  if (status === 404) {
    return {
      kind: 'needs_review',
      reason: 'The post you replied to or quoted is gone or hidden.'
    }
  }
  if (status === 410) {
    return {
      kind: 'needs_review',
      reason:
        'This post was sent and then deleted. Check it, then send it again.',
      clearSubmit: true
    }
  }
  if (status !== undefined) {
    // The route can answer 400 after the status was committed (its
    // catch-all, a swallowed discard failure, serialization or the replay
    // path), so a 400 to a POST is treated as a kept post: locked under the
    // same key, media not ours to delete.
    const mayBeKept = status === 400 && !preflight
    return {
      kind: 'couldnt_send',
      reason: (error as Error).message,
      ...(mayBeKept || draft.lockedMessage
        ? { lockedMessage: lockMessage(error, draft, true) }
        : {})
    }
  }
  return {
    kind: 'couldnt_send',
    reason:
      error instanceof Error && error.message
        ? error.message
        : 'Something went wrong.'
  }
}

const needsReview = (reason: string): Outcome => ({
  kind: 'needs_review',
  reason
})

// A gallery-settings answer other than 401/429 fails open, as PostBox does; a
// network failure is rethrown, so the item waits instead.
const settingsFailOpen = (error: unknown) =>
  error instanceof ApiRequestError &&
  error.status !== 401 &&
  error.status !== 429

/**
 * Checks a draft that was never POSTed before sending it; `null` means go
 * ahead. Thrown errors are classified as pre-flight failures (nothing sent).
 */
export const preflight = async (
  draft: DraftRecord,
  deps: Pick<
    SendQueueDeps,
    'getStatusIfReadable' | 'getGallerySettings' | 'now'
  >,
  now: number,
  signal?: AbortSignal
): Promise<Outcome | null> => {
  if (draft.queue && now - draft.queue.queuedAt > MAX_QUEUE_AGE_MS) {
    return needsReview('Waited more than 24 hours. Check it, then send it.')
  }
  if (
    draft.attachments.some(
      (item) => item.mediaType.startsWith('video/') && !item.mediaId
    )
  ) {
    return needsReview('Videos stay as drafts.')
  }
  const savedAtSeconds = Math.floor((draft.updatedAt ?? draft.createdAt) / 1000)
  try {
    const targets = [
      { status: draft.replyTo, verb: 'replied to', quote: false },
      { status: draft.quoteOf, verb: 'quoted', quote: true }
    ]
    for (const { status, verb, quote } of targets) {
      if (!status) continue
      const current = await deps.getStatusIfReadable(status.id, { signal })
      if (!current)
        return needsReview(`The post you ${verb} is gone or hidden.`)
      if (
        current.edited_at &&
        Math.floor(Date.parse(current.edited_at) / 1000) > savedAtSeconds
      ) {
        return needsReview(
          `The post you ${verb} was edited since you wrote this.`
        )
      }
      if (quote && current.quote_approval?.current_user === 'denied') {
        return needsReview("Quoting this post isn't allowed any more.")
      }
    }
    if (draft.attachments.length > 0) {
      const settings = await deps.getGallerySettings().catch((error) => {
        if (settingsFailOpen(error)) return null
        throw error
      })
      if (
        settings?.allowEmptyDescription === false &&
        draft.attachments.some(
          (item) => !item.decorative && !item.description.trim()
        )
      ) {
        return needsReview('Add a description to each photo, then send it.')
      }
    }
  } catch (error) {
    return classifySendOutcome(error, draft, {
      now: deps.now(),
      preflight: true
    })
  }
  return null
}

// `AbortSignal.any` needs Safari 17.4: link the drain's signal and a timer by hand.
const sendSignal = (parent: AbortSignal, timeoutMs: number) => {
  const controller = new AbortController()
  const abort = () => controller.abort(parent.reason)
  if (parent.aborted) abort()
  else parent.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(
    () =>
      controller.abort(new DOMException('The send timed out', 'TimeoutError')),
    timeoutMs
  )
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', abort)
    }
  }
}

interface SendContext {
  actorId: string
  signal: AbortSignal
  deps: SendQueueDeps
  now: number
}

/**
 * Uploads what a draft still lacks, from the bytes in IndexedDB (kept after
 * the upload). Each id is written before the next upload and before the
 * checkpoint, so a retry reuses it and never uploads twice. A thrown error
 * leaves `submit` unset: nothing was POSTed, so it is classified as pre-flight.
 * `held.draft` follows every write (even when this throws, so the outcome
 * write has the current revision). Returns false when another writer owns
 * the item now.
 */
const uploadPending = async (
  held: { draft: DraftRecord },
  { actorId, signal, deps }: Pick<SendContext, 'actorId' | 'signal' | 'deps'>
): Promise<boolean> => {
  // Refused (409, actor mismatch) unless this is still the signed-in profile,
  // so a stale tab never uploads its bytes as another actor.
  const expected = { expectedActorId: actorId }
  const claimed = held.draft
  // A failed write means another tab owns the draft: delete the orphan upload.
  const persist = async (
    mutate: (record: DraftRecord) => DraftRecord,
    cleanup: () => Promise<unknown>
  ) => {
    try {
      held.draft = await deps.updateQueuedDraft(
        claimed.id,
        held.draft.revision,
        mutate
      )
      return true
    } catch {
      await cleanup().catch(() => undefined)
      return false
    }
  }
  // The upload helpers take no signal, so a hung upload would hold the sender
  // lock past a sign-out or unmount. Stop waiting instead; an upload that
  // lands later stays on the server as unposted media (Settings → Media).
  const untilAborted = <T>(work: Promise<T>): Promise<T> => {
    const aborted = new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason))
    })
    // Settled after the race when the upload wins: not an unhandled rejection.
    aborted.catch(() => undefined)
    // An upload that already finished wins, so its id is still persisted.
    return Promise.race([work, aborted])
  }
  const blobFor = async (localId: string, fileName: string) => {
    const blob = await deps.getDraftBlob(localId)
    if (!blob || blob.draftId !== claimed.id) {
      throw new Error(`${fileName} is no longer on this device.`)
    }
    return blob
  }

  for (const item of claimed.attachments) {
    if (item.mediaId) continue
    if (signal.aborted) throw signal.reason
    const blob = await blobFor(item.localId, item.fileName)
    const media = await untilAborted(
      deps.uploadAttachment(
        blobRecordToFile(blob),
        blobRecordToPosterFile(blob),
        expected
      )
    )
    if (!media) throw new Error(`The server didn't accept ${item.fileName}.`)
    const saved = await persist(
      (record) => ({
        ...record,
        attachments: record.attachments.map((a) =>
          a.localId === item.localId
            ? {
                ...a,
                mediaId: media.id,
                url: media.url,
                posterUrl: media.posterUrl,
                width: media.width,
                height: media.height,
                owned: true
              }
            : a
        )
      }),
      () => deps.deleteUnpostedMedia(media.id)
    )
    if (!saved) return false
  }

  const file = claimed.fitnessFile
  if (file && !file.fitnessFileId) {
    if (signal.aborted) throw signal.reason
    const blob = await blobFor(file.localId, file.fileName)
    const uploaded = await untilAborted(
      deps.uploadFitnessFile(blobRecordToFile(blob), undefined, expected)
    )
    const saved = await persist(
      (record) => {
        if (!record.fitnessFile) throw new Error('The activity file is gone')
        return {
          ...record,
          fitnessFile: {
            ...record.fitnessFile,
            fitnessFileId: uploaded.id,
            owned: true
          }
        }
      },
      () => deps.deleteUnpostedFitnessFile(uploaded.id)
    )
    if (!saved) return false
  }
  return true
}

/**
 * One claimed draft, through the POST. Returns the latest record this tab
 * wrote with the outcome, or `null` when the item is dropped for this drain
 * (the checkpoint could not be written, so nothing was sent).
 */
const sendOne = async (
  claimed: DraftRecord,
  { actorId, signal, deps, now }: SendContext
): Promise<{ draft: DraftRecord; outcome: Outcome } | null> => {
  let draft = claimed
  let posting = false
  try {
    const firstAttemptAt = draft.queue?.firstAttemptAt
    if (!firstAttemptAt) {
      const blocked = await preflight(draft, deps, now, signal)
      if (blocked) return { draft, outcome: blocked }
    } else if (now - firstAttemptAt > CHECKING_GIVE_UP_MS) {
      return {
        draft,
        outcome: needsReview(
          "We couldn't confirm whether it posted. Check your profile before sending it again."
        )
      }
    }

    const held = { draft }
    try {
      if (!(await uploadPending(held, { actorId, signal, deps }))) return null
    } finally {
      draft = held.draft
    }

    // Checkpoint, as `recordAttempt` does: the key used is persisted before
    // the POST. If this write fails, nothing is sent.
    const request = buildSubmitRequest(draft)
    const key =
      draft.submit?.fingerprint === request.fingerprint
        ? draft.submit.key
        : generatePublicId()
    try {
      draft = await deps.updateQueuedDraft(draft.id, draft.revision, (r) => {
        if (!r.queue) throw new Error('The draft is no longer queued')
        return {
          ...r,
          submit: { key, fingerprint: request.fingerprint },
          attemptedAt: r.attemptedAt ?? now,
          queue: {
            ...r.queue,
            firstAttemptAt: r.queue.firstAttemptAt ?? now,
            attempts: r.queue.attempts + 1
          }
        }
      })
    } catch {
      return null
    }

    posting = true
    const timed = sendSignal(signal, SEND_TIMEOUT_MS)
    try {
      const params = {
        idempotencyKey: key,
        expectedActorId: actorId,
        signal: timed.signal
      }
      if (request.kind === 'poll') {
        await deps.createPoll({ ...request.params, ...params })
      } else {
        await deps.createNote({ ...request.params, ...params })
      }
    } finally {
      timed.dispose()
    }
    return { draft, outcome: { kind: 'sent' } }
  } catch (error) {
    if (!signal.aborted) deps.reportRequestFailure(error)
    return {
      draft,
      outcome: classifySendOutcome(error, draft, {
        now: deps.now(),
        preflight: !posting
      })
    }
  }
}

const withoutClaim = (queue: DraftQueueState) => {
  const {
    claim: _claim,
    pauseRequested: _pauseRequested,
    nextAttemptAt: _nextAttemptAt,
    reason: _reason,
    pausedBy: _pausedBy,
    ...rest
  } = queue
  return rest
}

// The server may hold the post (a 503, 409 or 400 to the POST): lock the
// draft under its key (`submit` is kept) and never delete the media it uses,
// as the composer does.
const lockIfKept = (
  record: DraftRecord,
  lockedMessage: string | undefined
): DraftRecord =>
  lockedMessage
    ? {
        ...record,
        lockedMessage,
        attachments: record.attachments.map((item) => ({
          ...item,
          owned: false
        })),
        ...(record.fitnessFile
          ? { fitnessFile: { ...record.fitnessFile, owned: false } }
          : {})
      }
    : record

/** The queue write for an outcome other than `sent`. Every outcome clears `claim`. */
const applyOutcome = (
  record: DraftRecord,
  outcome: Exclude<Outcome, { kind: 'sent' }>
): DraftRecord => {
  if (!record.queue) throw new Error('The draft is no longer queued')
  const base = withoutClaim(record.queue)
  switch (outcome.kind) {
    case 'waiting':
      return {
        ...record,
        queue: {
          ...base,
          state: 'waiting',
          nextAttemptAt: outcome.nextAttemptAt
        }
      }
    case 'checking':
      return lockIfKept(
        {
          ...record,
          queue: {
            ...base,
            state: 'checking',
            nextAttemptAt: outcome.nextAttemptAt
          }
        },
        outcome.lockedMessage
      )
    case 'paused':
      return {
        ...record,
        queue: {
          ...base,
          state: 'paused',
          pausedBy: outcome.pausedBy,
          reason: outcome.reason,
          ...(outcome.nextAttemptAt !== undefined
            ? { nextAttemptAt: outcome.nextAttemptAt }
            : {})
        }
      }
    case 'couldnt_send':
      return lockIfKept(
        {
          ...record,
          queue: { ...base, state: 'couldnt_send', reason: outcome.reason }
        },
        outcome.lockedMessage
      )
    case 'needs_review': {
      if (!outcome.clearSubmit) {
        return {
          ...record,
          queue: { ...base, state: 'needs_review', reason: outcome.reason }
        }
      }
      // 410: nothing is kept under the key any more. Drop the key and every
      // "a POST was made" mark, so Review reopens the draft unlocked.
      const {
        submit: _submit,
        lockedMessage: _locked,
        attemptedAt: _attemptedAt,
        ...rest
      } = record
      const { firstAttemptAt: _firstAttemptAt, ...queue } = base
      return {
        ...rest,
        queue: { ...queue, state: 'needs_review', reason: outcome.reason }
      }
    }
  }
}

/** Back to `waiting`, or `checking` once a POST may have gone out. */
const releaseClaim = (record: DraftRecord): DraftRecord => {
  if (!record.queue) throw new Error('The draft is no longer queued')
  const { claim: _claim, pauseRequested, ...queue } = record.queue
  const back: DraftQueueState = {
    ...queue,
    state: queue.firstAttemptAt ? 'checking' : 'waiting'
  }
  return { ...record, queue: pauseRequested ? pausedByReader(back) : back }
}

export const drainQueue = async ({
  accountId,
  actorId,
  epoch,
  tabId,
  signal,
  deps,
  onProgress
}: DrainOptions): Promise<DrainResult> => {
  const result: DrainResult = {
    attempted: 0,
    sent: 0,
    needsReview: 0,
    failed: 0,
    paused: 0
  }
  const startedAt = deps.now()
  const drafts = (await deps.listDrafts({ actorId })).filter(
    (draft) => draft.accountId === accountId
  )
  // Listed under the sender lock, so this sees a 401 or profile switch that
  // another tab's pass wrote after this tab decided to drain: send nothing.
  const queued = drafts.some((draft) => holdsQueue(draft.queue))
    ? []
    : drafts
        .filter((draft) => isQueueClaimable(draft.queue, startedAt))
        .sort((a, b) => (a.queue?.queuedAt ?? 0) - (b.queue?.queuedAt ?? 0))
  const total = queued.length
  const counts = () => ({
    sent: result.sent,
    needsReview: result.needsReview,
    failed: result.failed,
    paused: result.paused
  })

  for (const [index, item] of queued.entries()) {
    if (signal.aborted || !deps.isOnline()) break
    const now = deps.now()
    const claimed = await deps
      .claimQueuedDraft(item.id, {
        tabId,
        now,
        leaseMs: CLAIM_LEASE_MS,
        accountId,
        epoch
      })
      .catch(() => null)
    if (!claimed) {
      // A dead tab's send the reader paused was taken back as paused, not
      // claimed: the list still shows it "Sending" until told.
      if (item.queue?.pauseRequested) deps.announce(item.id)
      continue
    }
    // The list re-reads, so the row shows it is being sent.
    deps.announce(claimed.id)
    result.attempted += 1
    onProgress({ phase: 'sending', index: index + 1, total, ...counts() })

    const heartbeat = setInterval(() => {
      void deps
        .renewClaim(item.id, { tabId, until: deps.now() + CLAIM_LEASE_MS })
        .catch(() => undefined)
    }, CLAIM_LEASE_MS / 3)
    let settled: Awaited<ReturnType<typeof sendOne>>
    try {
      settled = await sendOne(claimed, { actorId, signal, deps, now })
    } finally {
      clearInterval(heartbeat)
    }
    if (!settled) continue
    const { draft, outcome } = settled

    if (outcome.kind === 'sent') {
      // Contained: a failed delete leaves the item to a later drain, which
      // replays the same key, gets the original status back and deletes it.
      await deps
        .deleteDraftIfRevision(draft.id, draft.revision)
        .catch(() => undefined)
      result.sent += 1
      deps.announce(draft.id)
      continue
    }
    if (signal.aborted) {
      // Sign-out or unmount: hand the item back instead of holding its lease.
      await deps
        .updateQueuedDraft(draft.id, draft.revision, releaseClaim)
        .catch(() => undefined)
      deps.announce(draft.id)
      break
    }
    // Pause was pressed while this request was out (read inside the write, so
    // a Resume in between counts): a retry it settles into is paused instead.
    let joinedPause = false
    const written = await deps
      .updateQueuedDraft(draft.id, draft.revision, (record) => {
        const next = applyOutcome(record, outcome)
        joinedPause = Boolean(
          record.queue?.pauseRequested &&
          next.queue &&
          retriesOnItsOwn(next.queue)
        )
        if (joinedPause && next.queue) {
          return { ...next, queue: pausedByReader(next.queue) }
        }
        // A sign-in or profile-switch hold is lifted by the next load: the
        // reader's Pause stays marked on it so it outlasts that.
        return record.queue?.pauseRequested &&
          next.queue &&
          holdsQueue(next.queue)
          ? { ...next, queue: { ...next.queue, pauseRequested: true } }
          : next
      })
      .then(
        () => true,
        // Someone else owns the item now (a revision conflict).
        () => false
      )
    deps.announce(draft.id)
    if (!written) continue
    if (outcome.kind === 'needs_review') result.needsReview += 1
    if (outcome.kind === 'couldnt_send') result.failed += 1
    if (joinedPause && outcome.kind !== 'paused') result.paused += 1
    if (outcome.kind === 'paused') {
      result.paused += 1
      if (outcome.pausedBy === 'auth' || outcome.pausedBy === 'actor') break
    }
  }

  if (!signal.aborted) {
    onProgress({
      phase: result.attempted > 0 ? 'result' : 'idle',
      index: 0,
      total,
      ...counts()
    })
  }
  return result
}
