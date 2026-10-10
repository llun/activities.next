// Parameter and result types of the announcement domain (instance-wide
// announcements with their reads and emoji reactions).
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// An instance-wide announcement (Mastodon's "announcement"). `text` is the raw
// source; the HTML `content` is rendered at serialization time. `published`
// gates visibility to actors and `publishedAt` records when it first went live.
// `allDay`/`startsAt`/`endsAt` describe an optional active window.
// `startsAt`/`endsAt`/`publishedAt` are epoch milliseconds (or null) in the
// domain shape regardless of the backend's timestamp storage; `createdAt` and
// `updatedAt` are always epoch milliseconds.
export type AnnouncementData = {
  id: string
  text: string
  published: boolean
  allDay: boolean
  startsAt: number | null
  endsAt: number | null
  publishedAt: number | null
  createdAt: number
  updatedAt: number
}

export type CreateAnnouncementParams = {
  text: string
  startsAt?: number | null
  endsAt?: number | null
  allDay?: boolean
  published?: boolean
}
export type UpdateAnnouncementParams = {
  id: string
  text?: string
  startsAt?: number | null
  endsAt?: number | null
  allDay?: boolean
  published?: boolean
}
export type DeleteAnnouncementParams = { id: string }
export type GetAnnouncementParams = { id: string }
export type GetActiveAnnouncementsParams = {
  // Epoch milliseconds used to evaluate the active window.
  now: number
}
export type MarkAnnouncementReadParams = {
  announcementId: string
  actorId: string
}
export type AnnouncementReactionParams = {
  announcementId: string
  actorId: string
  name: string
}
export type GetAnnouncementReadIdsParams = {
  actorId: string
  announcementIds: string[]
}
export type GetAnnouncementReactionsParams = {
  announcementIds: string[]
  actorId: string
}

// One (announcement, name) reaction rollup: `count` is the number of distinct
// actors who reacted with `name`, and `me` is whether the querying `actorId` is
// among them.
export type AnnouncementReactionRollup = {
  announcementId: string
  name: string
  count: number
  me: boolean
}

export interface AnnouncementDatabase {
  // Admin: create an announcement. Sets publishedAt to the creation time when
  // `published` is true, otherwise leaves it null.
  createAnnouncement(
    params: CreateAnnouncementParams
  ): Promise<AnnouncementData>
  // Admin: partial update; bumps updatedAt. When `published` transitions from
  // false to true and publishedAt is still null, sets publishedAt. Returns the
  // updated row, or null when the announcement does not exist.
  updateAnnouncement(
    params: UpdateAnnouncementParams
  ): Promise<AnnouncementData | null>
  // Admin: delete an announcement and clean up its reads and reactions.
  deleteAnnouncement(params: DeleteAnnouncementParams): Promise<void>
  // Admin: all announcements, newest first by createdAt.
  getAnnouncements(): Promise<AnnouncementData[]>
  // Get a single announcement by id, or null when it does not exist.
  getAnnouncement(
    params: GetAnnouncementParams
  ): Promise<AnnouncementData | null>
  // Public: published announcements whose optional active window contains `now`
  // (startsAt is null or <= now, and endsAt is null or >= now), newest first.
  getActiveAnnouncements(
    params: GetActiveAnnouncementsParams
  ): Promise<AnnouncementData[]>
  // Per-actor: idempotently record that the actor read the announcement.
  markAnnouncementRead(params: MarkAnnouncementReadParams): Promise<void>
  // Per-actor: idempotently add a reaction on the (announcement, actor, name)
  // composite key.
  // Resolves false, storing nothing, when the reaction would add a distinct name
  // beyond MAX_ANNOUNCEMENT_REACTION_NAMES.
  addAnnouncementReaction(params: AnnouncementReactionParams): Promise<boolean>
  // Per-actor: remove a reaction.
  removeAnnouncementReaction(params: AnnouncementReactionParams): Promise<void>
  // Per-actor: which of `announcementIds` the actor has read.
  getAnnouncementReadIds(
    params: GetAnnouncementReadIdsParams
  ): Promise<string[]>
  // Reaction rollups grouped by (announcementId, name) for the given
  // announcements, with `me` flagged for the querying actor.
  getAnnouncementReactions(
    params: GetAnnouncementReactionsParams
  ): Promise<AnnouncementReactionRollup[]>
}
