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

  /** Leaves a field out to keep it; `syncError: null` clears it. */
  updateBlueskyAccountSync(params: {
    actorId: string
    lastSyncedAt?: number | null
    syncError?: string | null
  }): Promise<void>
}
