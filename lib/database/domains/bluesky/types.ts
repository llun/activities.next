// Bluesky accounts and posts stored as `actors` / `statuses` rows with
// `network = 'bluesky'` (lib/services/bluesky/records.ts builds their ids),
// the at:// record behind each post, and the follows an actor made on
// Bluesky.

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

export type BlueskyCrosspostState = 'pending' | 'posted' | 'failed'

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
   * Records the posted record. Returns whether a row was updated: false when
   * the post was deleted while its record was being created.
   */
  markBlueskyCrosspostPosted(params: {
    statusId: string
    uri: string
    cid: string
  }): Promise<boolean>
  markBlueskyCrosspostFailed(params: {
    statusId: string
    error: string
  }): Promise<void>
  /** Moves a failed cross-post back to 'pending'; false when it was not failed. */
  resetBlueskyCrosspostForRetry(params: { statusId: string }): Promise<boolean>
  deleteBlueskyCrosspost(params: { statusId: string }): Promise<void>
}
