// The send queue: drains drafts the user chose to "Send when online". Only
// type imports from the API modules, so loading this file pulls in no client
// code; the real dependencies are passed in as `deps` (defaults live with the
// provider, from sub-path imports, never the `@/lib/client` barrel).
//
// The bodies land with the sender; this file fixes the constants and shapes
// that the provider and the Drafts page code against.
import type { reportRequestFailure } from '@/lib/client/connection'
import type { uploadFitnessFile } from '@/lib/client/fitnessImports'
import type { deleteUnpostedFitnessFile } from '@/lib/client/fitnessRoutes'
import type { getGallerySettings } from '@/lib/client/gallery'
import type { deleteUnpostedMedia, uploadAttachment } from '@/lib/client/media'
import type {
  createNote,
  createPoll,
  getStatusIfReadable
} from '@/lib/client/statuses'

import type {
  claimQueuedDraft,
  deleteDraftIfRevision,
  getDraftBlob,
  listDrafts,
  renewClaim,
  updateQueuedDraft
} from './draftsDb'
import type { DraftQueuePause, SendQueueProgress } from './types'

/** A queued post older than this goes to Needs review before its first POST. */
export const MAX_QUEUE_AGE_MS = 86_400_000
/** Give up confirming whether a post landed after this long. */
export const CHECKING_GIVE_UP_MS = 6 * 86_400_000
export const SEND_TIMEOUT_MS = 30_000
export const CLAIM_LEASE_MS = 90_000
/** Backoff per attempt; the last value repeats. */
export const SEND_BACKOFF_MS = [
  5_000, 15_000, 45_000, 120_000, 300_000
] as const
export const DEFAULT_RETRY_AFTER_MS = 60_000

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

// Stub: the sender replaces this body.
export const drainQueue = async (
  _options: DrainOptions
): Promise<DrainResult> => ({
  attempted: 0,
  sent: 0,
  needsReview: 0,
  failed: 0,
  paused: 0
})
