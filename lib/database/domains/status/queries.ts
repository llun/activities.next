import {
  updateNote,
  updateNoteVisibility,
  updatePoll,
  updateStatusQuoteApprovalPolicy
} from '@/lib/database/domains/status/edits'
import {
  createTag,
  decreaseHashtagCounter,
  deleteStatusTagsByType,
  getHashtagCounter,
  getHashtagStatusesPage,
  getStatusesByHashtag,
  getTags,
  increaseHashtagCounter
} from '@/lib/database/domains/status/hashtags'
import {
  getFavouritedBy,
  getRebloggedBy
} from '@/lib/database/domains/status/interactions'
import {
  getActorAnnounceStatus,
  getActorAnnouncedStatusId,
  getActorStatusFromPathSegment,
  getStatusFromPublicId,
  getStatusFromUrl,
  getStatusFromUrlHash,
  getStatusIdByPublicId,
  getStatusIdsByPublicIds,
  getStatusPublicIds
} from '@/lib/database/domains/status/lookups'
import {
  getPinnedStatusIds,
  pinStatus,
  unpinStatus
} from '@/lib/database/domains/status/pins'
import {
  createPollAnswer,
  getActorPollVotes,
  getActorPollVotesForStatuses,
  hasActorVoted,
  incrementPollChoiceVotes,
  recordPollVotes
} from '@/lib/database/domains/status/polls'
import type {
  CreateAnnounceParams,
  CreateNoteParams,
  CreatePollParams,
  GetActorStatusFromPathSegmentParams,
  GetHashtagStatusesPageParams,
  GetStatusFromPublicIdParams,
  GetStatusFromUrlHashParams,
  GetStatusFromUrlParams,
  GetStatusesByHashtagParams,
  HasActorAnnouncedStatusParams,
  StatusHydration,
  UpdateNoteParams,
  UpdateNoteVisibilityParams,
  UpdatePollParams,
  UpdateStatusQuoteApprovalPolicyParams
} from '@/lib/database/domains/status/types'
import {
  createAnnounce,
  createNote,
  createNoteWithResult,
  createPoll,
  createPollWithResult
} from '@/lib/database/domains/status/writes'
import type { Db } from '@/lib/database/kysely'

// The status methods that run on Kysely: the lookups, the poll reads and
// votes, the hashtag reads, the tag writes and hashtag counters, the pins, the
// favourited-by and reblogged-by pages, the creates and the edits. The rest of
// the status domain (hydration, the actor and reply feeds, the counts, the
// edit history reads and deletion) is still the Knex mixin in
// lib/database/sql/status.ts; getSQLDatabase spreads both into the facade.
//
// The methods that return hydrated statuses read or write their rows here and
// hydrate them through `hydration`, the Knex mixin's getStatus,
// getStatusesByIds and row hydration, injected until hydration is ported.
// Nothing here calls hydration inside a transaction: updateNote and
// updateNoteVisibility read the status they rewrite before theirs, every edit
// returns its status hydrated after it, createAnnounce reads the boosted status
// before and after its own, and a create that lost a race on the status id
// hydrates the winner after its failed transaction (the other creates build the
// status they return from what they wrote, as before). The mixin's own
// hydration calls getTags, getActorAnnouncedStatusId, hasActorVoted and
// getActorPollVotes from this domain, through the root Kysely instance and
// never inside a Knex transaction.
export const createStatusQueries = (hydration: StatusHydration) => ({
  getStatusFromUrl: (db: Db, params: GetStatusFromUrlParams) =>
    getStatusFromUrl(db, hydration, params),
  getStatusFromUrlHash: (db: Db, params: GetStatusFromUrlHashParams) =>
    getStatusFromUrlHash(db, hydration, params),
  getStatusIdByPublicId,
  getStatusIdsByPublicIds,
  getStatusFromPublicId: (db: Db, params: GetStatusFromPublicIdParams) =>
    getStatusFromPublicId(db, hydration, params),
  getStatusPublicIds,
  getActorStatusFromPathSegment: (
    db: Db,
    params: GetActorStatusFromPathSegmentParams
  ) => getActorStatusFromPathSegment(db, hydration, params),
  getActorAnnouncedStatusId,
  getActorAnnounceStatus: (db: Db, params: HasActorAnnouncedStatusParams) =>
    getActorAnnounceStatus(db, hydration, params),
  pinStatus,
  unpinStatus,
  getPinnedStatusIds,
  getFavouritedBy,
  getRebloggedBy,
  getTags,
  getStatusesByHashtag: (db: Db, params: GetStatusesByHashtagParams) =>
    getStatusesByHashtag(db, hydration, params),
  getHashtagStatusesPage: (db: Db, params: GetHashtagStatusesPageParams) =>
    getHashtagStatusesPage(db, hydration, params),
  getHashtagCounter,
  hasActorVoted,
  getActorPollVotes,
  getActorPollVotesForStatuses,
  createNote: (db: Db, params: CreateNoteParams) =>
    createNote(db, hydration, params),
  createNoteWithResult: (db: Db, params: CreateNoteParams) =>
    createNoteWithResult(db, hydration, params),
  createAnnounce: (db: Db, params: CreateAnnounceParams) =>
    createAnnounce(db, hydration, params),
  createPoll: (db: Db, params: CreatePollParams) =>
    createPoll(db, hydration, params),
  createPollWithResult: (db: Db, params: CreatePollParams) =>
    createPollWithResult(db, hydration, params),
  updateNote: (db: Db, params: UpdateNoteParams) =>
    updateNote(db, hydration, params),
  updateStatusQuoteApprovalPolicy: (
    db: Db,
    params: UpdateStatusQuoteApprovalPolicyParams
  ) => updateStatusQuoteApprovalPolicy(db, hydration, params),
  updateNoteVisibility: (db: Db, params: UpdateNoteVisibilityParams) =>
    updateNoteVisibility(db, hydration, params),
  updatePoll: (db: Db, params: UpdatePollParams) =>
    updatePoll(db, hydration, params),
  createTag,
  deleteStatusTagsByType,
  increaseHashtagCounter,
  decreaseHashtagCounter,
  createPollAnswer,
  incrementPollChoiceVotes,
  recordPollVotes
})

export type StatusQueries = ReturnType<typeof createStatusQueries>
