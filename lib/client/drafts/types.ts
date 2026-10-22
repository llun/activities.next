// Dependency-free: only `import type`, so the database, the composer hook and
// the Drafts page share one shape without pulling code into each other.
import type { Duration } from '@/lib/services/statuses/pollDurations'
import type { QuoteApprovalPolicy, Status } from '@/lib/types/domain/status'
import type { MastodonVisibility } from '@/lib/utils/getVisibility'

export const DRAFTS_DB_NAME = 'activities_drafts_v1'
export const DRAFTS_DB_VERSION = 1

export interface DraftAttachment {
  /** Stable across the temp-id to media-id swap (PostBox `clientKeys`). */
  localId: string
  /** Set once an upload is confirmed. */
  mediaId?: string
  /** True only for media this draft uploaded (not initialMedia, not a kept post's). */
  owned: boolean
  mediaType: string
  fileName: string
  width?: number
  height?: number
  /** Server URLs once uploaded; never `blob:`. */
  url?: string
  posterUrl?: string
  description: string
  decorative: boolean
  /**
   * The bytes are in the `blobs` store. They stay there after the upload id
   * exists, until the post is confirmed sent or the draft is deleted, as the
   * draft's own copy. A reopened draft reuses `mediaId` while the server still
   * has it and rebuilds the attachment from these bytes only when it has no
   * `mediaId`; a server copy that has gone missing is for the pre-flight
   * attachment check to catch, not for a re-upload.
   */
  hasBlob: boolean
}

export interface DraftFitnessFile {
  localId: string
  fileName: string
  mimeType: string
  size: number
  fitnessFileId?: string
  owned: boolean
  /** Kept after the upload, like {@link DraftAttachment.hasBlob}. */
  hasBlob: boolean
}

export interface DraftPoll {
  choices: string[]
  durationInSeconds: Duration
  pollType: 'oneOf' | 'anyOf'
}

export type DraftQueueStateName =
  | 'waiting'
  | 'sending'
  | 'checking'
  | 'needs_review'
  | 'couldnt_send'
  | 'paused'

export type DraftQueuePause = 'user' | 'auth' | 'rate_limit' | 'actor'

/** A draft the user chose to send when back online. Absent = a plain draft. */
export interface DraftQueueState {
  state: DraftQueueStateName
  /** Send when online; the 24 h clock. */
  queuedAt: number
  /** POSTs made; indexes the send backoff. */
  attempts: number
  /** First POST; the 6-day give-up clock, and "may have posted". */
  firstAttemptAt?: number
  /** Not claimable before this. */
  nextAttemptAt?: number
  /** Only while `state === 'sending'`. */
  claim?: { tabId: string; until: number }
  /** Shown under the chip (needs_review, couldnt_send, paused). */
  reason?: string
  /** Only while `state === 'paused'`. */
  pausedBy?: DraftQueuePause
  /**
   * Pause was pressed while the item was `sending` (a retry it settles into
   * is paused instead) or held by a sign-in or profile-switch pause (lifting
   * that hold leaves it paused by the reader).
   */
  pauseRequested?: true
}

/** What the status slot shows while the queue sends, and just after. */
export interface SendQueueProgress {
  phase: 'idle' | 'sending' | 'result'
  /** "Sending index of total". */
  index: number
  total: number
  sent: number
  needsReview: number
  failed: number
  paused: number
}

export interface DraftRecord {
  id: string
  accountId: string
  actorId: string
  /** 1 on the first save, +1 per save. */
  revision: number
  createdAt: number
  updatedAt: number
  composer: 'post-box' | 'reply-box'
  text: string
  contentWarning: string
  contentWarningVisible: boolean
  visibility: MastodonVisibility
  quoteApprovalPolicy: QuoteApprovalPolicy
  language?: string
  /** `cleanJson` snapshot: list preview and editor seed. */
  replyTo?: Status
  quoteOf?: Status
  poll?: DraftPoll
  attachments: DraftAttachment[]
  fitnessFile?: DraftFitnessFile
  /** First create POST for this content: gates fitness-file deletion. */
  attemptedAt?: number
  /** The Idempotency-Key in use, so a reopened draft replays instead of duplicating. */
  submit?: { key: string; fingerprint: string }
  /** The server kept the post (503/409): the composer reopens locked. */
  lockedMessage?: string
  /**
   * Set when the draft waits to be sent. Queue-only writes do not change
   * `updatedAt`, which means "content saved at".
   */
  queue?: DraftQueueState
}

export interface DraftBlobRecord {
  /** The attachment's (or fitness file's) `localId`. */
  id: string
  draftId: string
  /** Lets sign-out delete bytes whose draft record was never written. */
  accountId: string
  bytes: ArrayBuffer
  mimeType: string
  fileName: string
  lastModified: number
  poster?: { bytes: ArrayBuffer; mimeType: string; fileName: string }
}
