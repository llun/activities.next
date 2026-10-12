import {
  deleteStatus,
  deleteStatusEditHistory,
  deleteStatusWithQueueJob
} from '@/lib/database/domains/status/deletion'
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
import { getStatusEditHistory } from '@/lib/database/domains/status/history'
import {
  getStatus,
  hydrateStatusRow
} from '@/lib/database/domains/status/hydration'
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
import {
  getActorStatuses,
  getActorStatusesCount,
  getStatusReblogsCount,
  getStatusReblogsCounts,
  getStatusReplies,
  getStatusRepliesCount,
  getStatusRepliesCounts,
  getStatusesByIds
} from '@/lib/database/domains/status/reads'
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

// The status methods, all on Kysely: the lookups, the poll reads and votes,
// the hashtag reads, the tag writes and hashtag counters, the pins, the
// favourited-by and reblogged-by pages, the creates and the edits, the reads
// and hydration (getStatus, the actor and reply feeds, getStatusesByIds, the
// counts and the edit history), and the deletions (deleteStatus,
// deleteStatusWithQueueJob, deleteStatusEditHistory). getSQLDatabase binds
// them into the facade.
//
// The lookups, hashtag reads and writes that return hydrated statuses take
// their hydration as an argument (`hydrationFor(db)`, which statusQueries
// binds to this domain's getStatus, getStatusesByIds and hydrateStatusRow on
// the same `db`), so their tests can record what they hydrate. Nothing here
// hydrates inside a transaction: updateNote and updateNoteVisibility read the
// status they rewrite before theirs, every edit returns its status hydrated
// after it, createAnnounce reads the boosted status before and after its own,
// and a create that lost a race on the status id hydrates the winner after its
// failed transaction (the other creates build the status they return from
// what they wrote, as before).
export const statusHydrationFor = (db: Db): StatusHydration => ({
  getStatus: (params) => getStatus(db, params),
  getStatusesByIds: (params) => getStatusesByIds(db, params),
  hydrateStatusRow: (row, currentActorId) =>
    hydrateStatusRow(db, row, currentActorId)
})

export const createStatusQueries = (
  hydrationFor: (db: Db) => StatusHydration
) => ({
  getStatusFromUrl: (db: Db, params: GetStatusFromUrlParams) =>
    getStatusFromUrl(db, hydrationFor(db), params),
  getStatusFromUrlHash: (db: Db, params: GetStatusFromUrlHashParams) =>
    getStatusFromUrlHash(db, hydrationFor(db), params),
  getStatusIdByPublicId,
  getStatusIdsByPublicIds,
  getStatusFromPublicId: (db: Db, params: GetStatusFromPublicIdParams) =>
    getStatusFromPublicId(db, hydrationFor(db), params),
  getStatusPublicIds,
  getActorStatusFromPathSegment: (
    db: Db,
    params: GetActorStatusFromPathSegmentParams
  ) => getActorStatusFromPathSegment(db, hydrationFor(db), params),
  getActorAnnouncedStatusId,
  getActorAnnounceStatus: (db: Db, params: HasActorAnnouncedStatusParams) =>
    getActorAnnounceStatus(db, hydrationFor(db), params),
  pinStatus,
  unpinStatus,
  getPinnedStatusIds,
  getFavouritedBy,
  getRebloggedBy,
  getTags,
  getStatusesByHashtag: (db: Db, params: GetStatusesByHashtagParams) =>
    getStatusesByHashtag(db, hydrationFor(db), params),
  getHashtagStatusesPage: (db: Db, params: GetHashtagStatusesPageParams) =>
    getHashtagStatusesPage(db, hydrationFor(db), params),
  getHashtagCounter,
  hasActorVoted,
  getActorPollVotes,
  getActorPollVotesForStatuses,
  createNote: (db: Db, params: CreateNoteParams) =>
    createNote(db, hydrationFor(db), params),
  createNoteWithResult: (db: Db, params: CreateNoteParams) =>
    createNoteWithResult(db, hydrationFor(db), params),
  createAnnounce: (db: Db, params: CreateAnnounceParams) =>
    createAnnounce(db, hydrationFor(db), params),
  createPoll: (db: Db, params: CreatePollParams) =>
    createPoll(db, hydrationFor(db), params),
  createPollWithResult: (db: Db, params: CreatePollParams) =>
    createPollWithResult(db, hydrationFor(db), params),
  updateNote: (db: Db, params: UpdateNoteParams) =>
    updateNote(db, hydrationFor(db), params),
  updateStatusQuoteApprovalPolicy: (
    db: Db,
    params: UpdateStatusQuoteApprovalPolicyParams
  ) => updateStatusQuoteApprovalPolicy(db, hydrationFor(db), params),
  updateNoteVisibility: (db: Db, params: UpdateNoteVisibilityParams) =>
    updateNoteVisibility(db, hydrationFor(db), params),
  updatePoll: (db: Db, params: UpdatePollParams) =>
    updatePoll(db, hydrationFor(db), params),
  createTag,
  deleteStatusTagsByType,
  increaseHashtagCounter,
  decreaseHashtagCounter,
  createPollAnswer,
  incrementPollChoiceVotes,
  recordPollVotes,
  getStatus,
  getStatusReplies,
  getStatusEditHistory,
  getActorStatusesCount,
  getActorStatuses,
  getStatusesByIds,
  getStatusReblogsCount,
  getStatusReblogsCounts,
  getStatusRepliesCount,
  getStatusRepliesCounts,
  deleteStatusEditHistory,
  deleteStatus,
  deleteStatusWithQueueJob
})

export const statusQueries = createStatusQueries(statusHydrationFor)

export type StatusQueries = typeof statusQueries
