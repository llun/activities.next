import {
  getHashtagCounter,
  getHashtagStatusesPage,
  getStatusesByHashtag,
  getTags
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
  getActorPollVotes,
  getActorPollVotesForStatuses,
  hasActorVoted
} from '@/lib/database/domains/status/polls'
import type {
  GetActorStatusFromPathSegmentParams,
  GetHashtagStatusesPageParams,
  GetStatusFromPublicIdParams,
  GetStatusFromUrlHashParams,
  GetStatusFromUrlParams,
  GetStatusesByHashtagParams,
  HasActorAnnouncedStatusParams,
  StatusHydration
} from '@/lib/database/domains/status/types'
import type { Db } from '@/lib/database/kysely'

// The status methods that run on Kysely: the lookups, the poll reads, the
// hashtag reads, the pins and the favourited-by and reblogged-by pages. The
// rest of the status domain is still the Knex mixin in
// lib/database/sql/status.ts; getSQLDatabase spreads both into the facade.
//
// The methods that return hydrated statuses read their rows here and hydrate
// them through `hydration`, the Knex mixin's getStatus, getStatusesByIds and
// row hydration, injected until hydration is ported. Nothing here opens a
// transaction around a hydration call. The mixin's own hydration calls
// getTags, getActorAnnouncedStatusId, hasActorVoted and getActorPollVotes from
// this domain, through the root Kysely instance and never inside a Knex
// transaction.
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
  getActorPollVotesForStatuses
})

export type StatusQueries = ReturnType<typeof createStatusQueries>
