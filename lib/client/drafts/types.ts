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
   * exists, until the post is confirmed sent or the draft is deleted: the
   * server may clean up an unattached upload, and the bytes let the draft
   * re-upload it.
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
