// Bluesky accounts and posts stored as `actors` / `statuses` rows with
// `network = 'bluesky'` (lib/services/bluesky/records.ts builds their ids),
// the at:// record behind each post, and the follows an actor made on
// Bluesky.
import type { CreateQueueJobParams } from '@/lib/database/domains/queueJob/types'

export type UpsertBlueskyActorParams = {
  did: string
  handle: string
  name?: string | null
  summary?: string | null
  iconUrl?: string | null
  headerImageUrl?: string | null
  followersCount?: number | null
  followingCount?: number | null
  postsCount?: number | null
}

export type BlueskyPostAttachment = {
  url: string
  thumbnailUrl?: string | null
  mediaType: string
  width?: number
  height?: number
  description?: string
}

export type UpsertBlueskyPostParams = {
  uri: string
  cid: string
  did: string
  rkey: string
  actorId: string
  // Already-rendered HTML (blueskyPostToHtml).
  text: string
  createdAt: number
  replyToStatusId?: string | null
  attachments: BlueskyPostAttachment[]
  // A content-warning label (adult or graphic media): media shown blurred.
  sensitive?: boolean
}

export type BlueskyRecord = {
  statusId: string
  uri: string
  cid: string
  createdAt: number
}

export type BlueskyFollow = {
  actorId: string
  targetActorId: string
  uri: string
  createdAt: number
}

export type BlueskyInteractionKind = 'like' | 'repost'

export type BlueskyInteraction = {
  actorId: string
  statusId: string
  kind: BlueskyInteractionKind
  uri: string
  createdAt: number
}

export type BlueskyCrosspostState = 'pending' | 'posting' | 'posted' | 'failed'

export type BlueskyCrosspost = {
  statusId: string
  actorId: string
  // The Bluesky record, once it exists.
  uri: string | null
  cid: string | null
  state: BlueskyCrosspostState
  error: string | null
  createdAt: number
  updatedAt: number
}

export interface BlueskyDatabase {
  /**
   * Creates or refreshes the actor row of a Bluesky account and returns its
   * id, or null when a non-Bluesky row already holds that id. Writes nothing
   * when every given value is already stored.
   */
  upsertBlueskyActor(params: UpsertBlueskyActorParams): Promise<string | null>
  /**
   * Idempotent on `uri`: `created` is false when the post was stored. A record
   * whose status is gone is replaced.
   */
  upsertBlueskyPost(
    params: UpsertBlueskyPostParams
  ): Promise<{ statusId: string; created: boolean }>
  getBlueskyRecordByStatusId(params: {
    statusId: string
  }): Promise<BlueskyRecord | null>
  getBlueskyRecordByUri(params: { uri: string }): Promise<BlueskyRecord | null>
  /** Whether the status is in the actor's Home (the MAIN timeline). */
  isBlueskyPostInHome(params: {
    actorId: string
    statusId: string
  }): Promise<boolean>
  /**
   * Removes from the actor's Home (the MAIN timeline) any timeline row of a
   * boost (Announce) whose original status is `statusId`. Leaves the Announce
   * status itself and other timelines untouched.
   */
  removeBoostsOfStatusFromHome(params: {
    actorId: string
    statusId: string
  }): Promise<void>

  /** Replaces the record URI of an existing follow. */
  createBlueskyFollow(params: {
    actorId: string
    targetActorId: string
    uri: string
  }): Promise<void>
  deleteBlueskyFollow(params: {
    actorId: string
    targetActorId: string
  }): Promise<void>
  getBlueskyFollow(params: {
    actorId: string
    targetActorId: string
  }): Promise<BlueskyFollow | null>
  getBlueskyFollowTargetIds(params: { actorId: string }): Promise<string[]>

  getBlueskyInteraction(params: {
    actorId: string
    statusId: string
    kind: BlueskyInteractionKind
  }): Promise<BlueskyInteraction | null>
  /** Idempotent on `(actorId, statusId, kind)`: keeps the stored record URI. */
  createBlueskyInteraction(params: {
    actorId: string
    statusId: string
    kind: BlueskyInteractionKind
    uri: string
  }): Promise<void>
  deleteBlueskyInteraction(params: {
    actorId: string
    statusId: string
    kind: BlueskyInteractionKind
  }): Promise<void>
  /**
   * Sets the post's like, repost and reply counters to the given counts,
   * skipping any value that is missing, negative or not an integer.
   */
  setBlueskyPostCounts(params: {
    statusId: string
    likes?: number | null
    reposts?: number | null
    replies?: number | null
  }): Promise<void>

  /** Leaves a field out to keep it; `syncError: null` clears it. */
  updateBlueskyAccountSync(params: {
    actorId: string
    lastSyncedAt?: number | null
    syncError?: string | null
  }): Promise<void>

  getBlueskyCrosspost(params: {
    statusId: string
  }): Promise<BlueskyCrosspost | null>
  getBlueskyCrosspostByUri(params: {
    uri: string
  }): Promise<BlueskyCrosspost | null>
  /** The cross-post rows of a page of statuses, keyed by statusId. */
  getBlueskyCrosspostsByStatusIds(params: {
    statusIds: string[]
  }): Promise<Map<string, BlueskyCrosspost>>
  /**
   * Inserts a 'pending' row for the status, or leaves the existing one alone.
   * Returns whether this call created it, so only one caller posts the status.
   */
  claimBlueskyCrosspost(params: {
    statusId: string
    actorId: string
  }): Promise<boolean>
  /**
   * Atomically claims an exclusive posting attempt for a 'pending' row (or a
   * stale 'posting' row older than STALE_CROSSPOST_MS) and returns the new
   * attempt token, or null when another attempt owns it or it is already
   * done/failed.
   */
  beginBlueskyCrosspostAttempt(params: {
    statusId: string
  }): Promise<string | null>
  /**
   * Moves the attempt owner's 'posting' row back to 'pending' with a fresh
   * updatedAt and clears attemptId so the next retry can begin. No-op when
   * another attempt owns it or the row is no longer 'posting'.
   */
  releaseBlueskyCrosspostAttempt(params: {
    statusId: string
    attemptId: string
  }): Promise<boolean>
  /**
   * Records the posted record for the attempt owner's 'posting' row and clears
   * attemptId. Returns whether a row was updated: false when the post was
   * deleted or another attempt took over while the record was being created.
   */
  markBlueskyCrosspostPosted(params: {
    statusId: string
    attemptId: string
    uri: string
    cid: string
  }): Promise<boolean>
  /**
   * Marks the attempt owner's 'posting' row failed and clears attemptId.
   * No-op when another attempt took over or the row is no longer 'posting'.
   */
  markBlueskyCrosspostFailed(params: {
    statusId: string
    attemptId: string
    error: string
  }): Promise<boolean>
  /**
   * Marks a 'pending' row or a stale 'posting' row (older than
   * STALE_CROSSPOST_MS) failed without touching a fresh 'posting' or 'posted'
   * row (for failures before an attempt has been claimed).
   */
  markBlueskyCrosspostFailedIfAttemptable(params: {
    statusId: string
    error: string
  }): Promise<boolean>
  /**
   * Moves a failed cross-post, or a stale pending/posting one (older than
   * STALE_CROSSPOST_MS), back to 'pending'; false otherwise.
   */
  resetBlueskyCrosspostForRetry(params: { statusId: string }): Promise<boolean>
  /**
   * Deletes the cross-post row and returns what was deleted, or null if absent.
   */
  deleteBlueskyCrosspost(params: {
    statusId: string
  }): Promise<BlueskyCrosspost | null>
  /**
   * Deletes the cross-post row and, when `buildQueueJob` returns a job for the
   * deleted row, inserts that queue job in the same transaction. Returns the
   * deleted row, or null if absent.
   */
  deleteBlueskyCrosspostWithQueueJob(params: {
    statusId: string
    buildQueueJob: (crosspost: BlueskyCrosspost) => CreateQueueJobParams | null
  }): Promise<BlueskyCrosspost | null>
  /**
   * Atomically deletes an in-flight cross-post row (pending, posting, or posted
   * without a uri) and returns `{ crosspost, deleted: true }`. Leaves a failed
   * row or a posted row with a uri intact and returns `{ crosspost, deleted: false }`
   * so a non-database queue can publish the delete job before removing the row.
   * A row a concurrent Retry moved from failed back to pending between the
   * delete and the re-read is deleted too, and reported as `deleted: true`.
   * Returns null when no row exists.
   */
  deleteBlueskyCrosspostUnlessPosted(params: {
    statusId: string
  }): Promise<{ crosspost: BlueskyCrosspost; deleted: boolean } | null>
  /**
   * Deletes a row only while it is 'pending' or a stale 'posting' row (older
   * than STALE_CROSSPOST_MS), never a fresh 'posting' or 'posted' row whose
   * remote copies are owned by an active attempt or delete/visibility handlers.
   */
  deleteBlueskyCrosspostIfAttemptable(params: {
    statusId: string
  }): Promise<boolean>
}
