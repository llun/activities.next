// Parameter and result types of the status methods that run on Kysely: the
// lookups by url, url hash, publicId and path segment, the poll reads, the
// hashtag reads, the pins and the favourited-by and reblogged-by pages.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working. The rest of the status domain (the writes, hydration, the actor
// and reply feeds, the counts and deletion) is still the Knex mixin in
// lib/database/sql/status.ts, with its types in operations.ts.
import type { Selectable } from 'kysely'

import type { Statuses } from '@/lib/database/kysely/db'
import type { Status } from '@/lib/types/domain/status'
import type { Tag } from '@/lib/types/domain/tag'

export type GetStatusFromUrlParams = {
  url: string
  // The signed-in viewer, so the resolved status carries their own like,
  // bookmark and reaction state. A status's `url` is its web permalink, which
  // is never equal to its `id`, so this lookup — not the id lookup beside it —
  // is what a pasted link actually resolves through.
  currentActorId?: string
}
export type GetStatusFromUrlHashParams = {
  urlHash: string
  actorId?: string
  // The signed-in viewer, so the returned status carries their own like,
  // bookmark and reaction state — the hash route lands on the same status
  // detail page as the id route and must hydrate it the same way.
  currentActorId?: string
}

export interface GetStatusIdByPublicIdParams {
  publicId: string
}
export interface GetStatusIdsByPublicIdsParams {
  publicIds: string[]
}
export interface GetStatusFromPublicIdParams {
  publicId: string
  currentActorId?: string
}
export interface GetStatusPublicIdsParams {
  statusIds: string[]
}
export interface GetActorStatusFromPathSegmentParams {
  actorId: string
  // The `[statusId]` segment of `/users/:username/statuses/:statusId`. It is
  // either the tail of the status URI or the status publicId — a status created
  // before publicIds existed keeps its original tail and only gained a publicId
  // in the backfill, so both forms address the same row.
  pathSegment: string
  withReplies?: boolean
}

export type GetActorAnnouncedStatusIdParams = {
  actorId: string
  originalStatusId: string
}
export type HasActorAnnouncedStatusParams = {
  statusId: string
  actorId?: string
}

export type PinStatusParams = {
  actorId: string
  statusId: string
  maxPinnedStatuses?: number
}
export type GetPinnedStatusIdsParams = {
  actorId: string
  statusIds?: string[]
}

export type GetFavouritedByParams = {
  statusId: string
  limit: number
  // Opaque base64url cursors (see favouritedByCursor). `maxId` pages toward
  // older favourites, `minId`/`sinceId` toward newer ones.
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type FavouritedByAccount = {
  actorId: string
  createdAt: number
}
export type GetRebloggedByParams = {
  statusId: string
  limit?: number
  maxStatusId?: string
  minStatusId?: string
  sinceStatusId?: string
  visibleToActorId?: string | null
}
export type RebloggedByAccount = {
  actorId: string
  statusId: string
}

export type GetTagsParams = {
  statusId: string
}
export type GetStatusesByHashtagParams = {
  hashtag: string
  // The signed-in viewer. Hydration only — it decides the like/bookmark/reaction
  // state on the returned statuses and never which statuses are returned (a tag
  // timeline is public by definition).
  currentActorId?: string
  limit?: number
  minStatusId?: string
  maxStatusId?: string
  // Attachments-only filter (Mastodon `only_media`).
  onlyMedia?: boolean
  // Author-locality scope (Mastodon `local`/`remote`): local means the author
  // has an actors row with a privateKey (this server hosts it).
  local?: boolean
  remote?: boolean
  // Mastodon tag-timeline modes: `anyTags` widen the primary match, `allTags`
  // must all be present, `noneTags` must all be absent. Bare names, no `#`.
  anyTags?: string[]
  allTags?: string[]
  noneTags?: string[]
}
export type GetHashtagStatusesPageParams = {
  hashtag: string
  limit: number
  offset: number
}
export type GetHashtagStatusesPageResult = {
  statuses: Status[]
  total: number
}
export type GetHashtagCounterParams = {
  hashtag: string
}

export type HasActorVotedParams = {
  statusId: string
  actorId: string
}
export type GetActorPollVotesParams = {
  statusId: string
  actorId: string
}
export type GetActorPollVotesForStatusesParams = {
  statusIds: string[]
  actorId: string
}

/** A `statuses` row as Kysely reads it. */
export type StatusRow = Selectable<Statuses>

/**
 * Where these queries get hydrated statuses from: the Knex status mixin
 * (getStatus, getStatusesByIds and its row hydration), injected by
 * lib/database/sql/index.ts until hydration is ported. Each runs on the root
 * Knex instance, so it is only called after this domain's own query, never
 * inside a transaction.
 */
export type StatusHydration = {
  getStatus(params: {
    statusId: string
    currentActorId?: string
    withReplies?: boolean
  }): Promise<Status | null>
  getStatusesByIds(params: {
    statusIds: string[]
    currentActorId?: string
  }): Promise<Status[]>
  // Hydrates a row this domain already read, as getStatus would after
  // reading it by id.
  hydrateStatusRow(
    row: StatusRow,
    currentActorId?: string
  ): Promise<Status | null>
}

/** The status methods that run on Kysely; StatusDatabase extends it. */
export interface StatusLookupDatabase {
  getStatusFromUrl(params: GetStatusFromUrlParams): Promise<Status | null>
  getStatusFromUrlHash(
    params: GetStatusFromUrlHashParams
  ): Promise<Status | null>
  getStatusIdByPublicId(
    params: GetStatusIdByPublicIdParams
  ): Promise<string | null>
  // publicId -> status URI, for the batch id resolver. One query per request
  // instead of one per id.
  getStatusIdsByPublicIds(
    params: GetStatusIdsByPublicIdsParams
  ): Promise<Map<string, string>>
  getStatusFromPublicId(
    params: GetStatusFromPublicIdParams
  ): Promise<Status | null>
  getStatusPublicIds(
    params: GetStatusPublicIdsParams
  ): Promise<Map<string, string>>
  // Resolves the `[statusId]` path segment of the ActivityPub status routes,
  // accepting either the status URI tail or the status publicId. Scoped to
  // `actorId`: a publicId belonging to another actor resolves to null instead
  // of surfacing under this actor's URL space.
  getActorStatusFromPathSegment(
    params: GetActorStatusFromPathSegmentParams
  ): Promise<Status | null>
  getActorAnnouncedStatusId(
    params: GetActorAnnouncedStatusIdParams
  ): Promise<string | null>
  getActorAnnounceStatus(
    params: HasActorAnnouncedStatusParams
  ): Promise<Status | null>
  pinStatus(params: PinStatusParams): Promise<boolean>
  unpinStatus(params: PinStatusParams): Promise<void>
  getPinnedStatusIds(params: GetPinnedStatusIdsParams): Promise<string[]>
  getFavouritedBy(params: GetFavouritedByParams): Promise<FavouritedByAccount[]>
  getRebloggedBy(params: GetRebloggedByParams): Promise<RebloggedByAccount[]>
  getTags(params: GetTagsParams): Promise<Tag[]>
  getStatusesByHashtag(params: GetStatusesByHashtagParams): Promise<Status[]>
  getHashtagStatusesPage(
    params: GetHashtagStatusesPageParams
  ): Promise<GetHashtagStatusesPageResult>
  getHashtagCounter(params: GetHashtagCounterParams): Promise<number>
  hasActorVoted(params: HasActorVotedParams): Promise<boolean>
  getActorPollVotes(params: GetActorPollVotesParams): Promise<number[]>
  getActorPollVotesForStatuses(
    params: GetActorPollVotesForStatusesParams
  ): Promise<Record<string, number[]>>
}
