// Parameter and result types of the status methods that run on Kysely: the
// lookups by url, url hash, publicId and path segment, the poll reads, the
// hashtag reads, the pins, the favourited-by and reblogged-by pages, and the
// writes (note, poll and boost creation, the note and poll edits, the
// visibility and quote-policy updates, the tag writes, the hashtag counters
// and the poll votes). lib/types/database/operations.ts re-exports them, so
// existing imports keep working. The rest of the status domain (hydration,
// the actor and reply feeds, the counts, the edit history reads and deletion)
// is still the Knex mixin in lib/database/sql/status.ts, with its types in
// operations.ts.
import type { Selectable } from 'kysely'

import type { Statuses } from '@/lib/database/kysely/db'
import type {
  AttachmentMediaMetadata,
  PostBoxAttachment
} from '@/lib/types/domain/attachment'
import type { QuoteApprovalPolicy, Status } from '@/lib/types/domain/status'
import type { Tag, TagType } from '@/lib/types/domain/tag'

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

interface BaseCreateStatusParams {
  id: string
  actorId: string
  to: string[]
  cc: string[]

  url: string
  text: string
  summary?: string | null
  reply?: string

  // Mastodon-compatible content flags persisted in the status content blob.
  sensitive?: boolean
  language?: string | null

  // Who may quote this status (FEP-044f / Mastodon 4.5). Persisted in the status
  // content blob, not a column. Omit to leave it unset (defaults to `public` at
  // consumption).
  quoteApprovalPolicy?: QuoteApprovalPolicy

  // The registered OAuth client (Mastodon "application") that authored the
  // status. Null when created through the web session.
  applicationName?: string | null
  applicationWebsite?: string | null

  createdAt?: number
  // The client-facing UUIDv7 id. Omit to mint one from createdAt (or now).
  // Callers that already generated the id for the status URI tail (Task 1.5)
  // pass it here so the URI tail, web-url tail, and stored publicId agree.
  publicId?: string
}

export type CreateNoteParams = BaseCreateStatusParams

/**
 * An attachment resolved for an edit: the client's media reference plus the
 * `medias` snapshot the attachment row carries (see `AttachmentMediaMetadata`).
 *
 * The three snapshot fields are REQUIRED, not optional, so a caller cannot
 * quietly hand `updateNote` a bare `PostBoxAttachment` and blank the
 * placeholder and focal point of every attachment it rewrites — the edit path
 * has to resolve them from the owner's own media rows first.
 */
export type UpdateNoteAttachment = PostBoxAttachment & AttachmentMediaMetadata

export type UpdateNoteParams = Pick<CreateNoteParams, 'text' | 'summary'> & {
  statusId: string
  attachments?: UpdateNoteAttachment[]
  // Omit to preserve the existing value; provide to overwrite.
  sensitive?: boolean
  language?: string | null
}

export type UpdateStatusQuoteApprovalPolicyParams = {
  statusId: string
  quoteApprovalPolicy: QuoteApprovalPolicy
}

export type UpdateNoteVisibilityParams = {
  statusId: string
  to: string[]
  cc: string[]
}

export type CreateAnnounceParams = Pick<
  BaseCreateStatusParams,
  'id' | 'actorId' | 'to' | 'cc' | 'createdAt' | 'publicId'
> & {
  originalStatusId: string
}

export type CreatePollParams = BaseCreateStatusParams & {
  choices: (string | { title: string; totalVotes?: number })[]
  endAt: number
  pollType?: 'oneOf' | 'anyOf'
  // Mastodon poll[hide_totals]: hide per-option tallies until the poll expires.
  hideTotals?: boolean
}

/**
 * Discriminated result of a status create that recovers from a concurrent
 * duplicate insert. `isNew` is false when a racing delivery of the same object
 * won the unique key and this call returned the winner's existing row — the
 * signal `createNoteJob` / `createPollJob` read to skip re-running their
 * (non-idempotent) tag / attachment / hashtag side effects. The plain
 * `createNote` / `createPoll` methods keep returning just the `Status`; only
 * the `*WithResult` variants surface `isNew`.
 */
export type CreateStatusResult = {
  status: Status
  isNew: boolean
}
export type UpdatePollParams = Pick<CreatePollParams, 'text' | 'summary'> & {
  statusId: string
  choices: { title: string; totalVotes: number }[]
  // Omit to preserve the existing values; provide to overwrite (user edits).
  sensitive?: boolean
  language?: string | null
  endAt?: number
  pollType?: 'oneOf' | 'anyOf'
  hideTotals?: boolean
  // When true `choices` replaces the option set and all recorded votes are
  // cleared (Mastodon edit semantics); when false/omitted `choices` only
  // refreshes tallies for the existing titles (federated poll refresh).
  resetVotes?: boolean
}

export type CreateTagParams = {
  statusId: string
  name: string
  type: TagType
  value?: string
  /**
   * For multi-hashtag insert flows only. Callers that set this for hashtag tags
   * must call indexHashtagSearchDocuments once after all skipped tags are
   * inserted.
   */
  skipSearchIndex?: boolean
}
export type DeleteStatusTagsByTypeParams = {
  statusId: string
  type: TagType
}
export type IncreaseHashtagCounterParams = {
  hashtag: string
}
export type DecreaseHashtagCounterParams = {
  hashtag: string
}

export type CreatePollAnswerParams = {
  statusId: string
  actorId: string
  choice: number
}
export type IncrementPollChoiceVotesParams = {
  statusId: string
  choiceIndex: number
}
export type RecordPollVotesParams = {
  statusId: string
  actorId: string
  choices: number[]
  allowAdditionalChoices?: boolean
}

/** A `statuses` row as Kysely reads it. */
export type StatusRow = Selectable<Statuses>

/**
 * Where these queries get hydrated statuses from: the Knex status mixin
 * (getStatus, getStatusesByIds and its row hydration), injected by
 * lib/database/sql/index.ts until hydration is ported. Each runs on the root
 * Knex instance, so it is only called outside this domain's transactions:
 * after its own query, before a write's transaction (the edits read the
 * status they rewrite through getStatus) or after it, never inside one.
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

/** The status writes that run on Kysely; StatusDatabase extends it. */
export interface StatusWriteDatabase {
  createNote(params: CreateNoteParams): Promise<Status>
  // Same insert as createNote, but reports whether the row was newly created
  // (isNew) or recovered from a concurrent duplicate. See CreateStatusResult.
  createNoteWithResult(params: CreateNoteParams): Promise<CreateStatusResult>
  createAnnounce(params: CreateAnnounceParams): Promise<Status | null>
  createPoll(params: CreatePollParams): Promise<Status>
  // Same insert as createPoll, but reports whether the row was newly created.
  createPollWithResult(params: CreatePollParams): Promise<CreateStatusResult>
  updateNote(params: UpdateNoteParams): Promise<Status | null>
  // Rewrites the status's quote-approval policy in the content blob without
  // recording an edit (no status_history append, no edited_at bump).
  updateStatusQuoteApprovalPolicy(
    params: UpdateStatusQuoteApprovalPolicyParams
  ): Promise<Status | null>
  updateNoteVisibility(
    params: UpdateNoteVisibilityParams
  ): Promise<Status | null>
  updatePoll(params: UpdatePollParams): Promise<Status | null>
  createTag(params: CreateTagParams): Promise<Tag>
  deleteStatusTagsByType(params: DeleteStatusTagsByTypeParams): Promise<void>
  increaseHashtagCounter(params: IncreaseHashtagCounterParams): Promise<void>
  decreaseHashtagCounter(params: DecreaseHashtagCounterParams): Promise<void>
  createPollAnswer(params: CreatePollAnswerParams): Promise<void>
  incrementPollChoiceVotes(
    params: IncrementPollChoiceVotesParams
  ): Promise<void>
  recordPollVotes(params: RecordPollVotesParams): Promise<boolean>
}
