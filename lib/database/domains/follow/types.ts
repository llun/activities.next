// Parameter and result types of the follow domain (follow relationships and
// follow requests). lib/types/database/operations.ts re-exports them, so
// existing imports keep working.
import type { Actor } from '@/lib/types/domain/actor'
import type { Follow, FollowStatus } from '@/lib/types/domain/follow'

export type CreateFollowParams = {
  // A caller-chosen id (a deterministic one makes the insert idempotent: when a
  // row with that id exists it is returned unchanged). Random when omitted.
  id?: string
  actorId: string
  targetActorId: string
  status: FollowStatus
  inbox: string
  sharedInbox: string
  // Optional local follow preferences (Mastodon follow params). Default when
  // omitted: reblogs=true, notify=false, languages=null (no language filter).
  reblogs?: boolean
  notify?: boolean
  languages?: string[] | null
}
export type UpdateFollowPreferencesParams = {
  actorId: string
  targetActorId: string
  // Only the fields actually provided are updated; omitted fields are left as-is.
  reblogs?: boolean
  notify?: boolean
  languages?: string[] | null
}
export type GetLocalFollowersForActorIdParams = { targetActorId: string }
export type GetLocalActorsFromFollowerUrlParams = { followerUrl: string }
export type GetLocalFollowsFromInboxUrlParams = {
  targetActorId: string
  followerInboxUrl: string
}
export type GetFollowFromIdParams = { followId: string }
export type GetAcceptedOrRequestedFollowParams = {
  actorId: string
  targetActorId: string
}
export type GetAcceptedFollowTargetActorIdsParams = {
  actorId: string
  targetActorIds: string[]
}
export type GetFollowersInboxParams = { targetActorId: string }
export type UpdateFollowStatusParams = {
  followId: string
  status: FollowStatus
}
// New type for getting follows with pagination
export type GetFollowingParams = {
  actorId: string
  limit: number
  maxId?: string | null
  // min_id and since_id are ordered differently: min_id returns the oldest band
  // immediately after the cursor, since_id the newest band above it.
  minId?: string | null
  sinceId?: string | null
}
export type GetFollowersParams = {
  targetActorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type GetAcceptedOrRequestedFollowsWithDomainParams = {
  actorId: string
  domain: string
  limit: number
}
export type GetFollowRequestsParams = {
  targetActorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type GetFollowRequestsCountParams = {
  targetActorId: string
}

export interface FollowDatabase {
  createFollow(params: CreateFollowParams): Promise<Follow>
  createFollowIfAbsent(
    params: CreateFollowParams
  ): Promise<{ follow: Follow; inserted: boolean }>
  updateFollowPreferences(
    params: UpdateFollowPreferencesParams
  ): Promise<Follow | null>
  getFollowFromId(params: GetFollowFromIdParams): Promise<Follow | null>
  getLocalFollowersForActorId(
    params: GetLocalFollowersForActorIdParams
  ): Promise<Follow[]>
  getLocalFollowsFromInboxUrl(
    params: GetLocalFollowsFromInboxUrlParams
  ): Promise<Follow[]>
  getLocalActorsFromFollowerUrl(
    params: GetLocalActorsFromFollowerUrlParams
  ): Promise<Actor[]>
  getAcceptedOrRequestedFollow(
    params: GetAcceptedOrRequestedFollowParams
  ): Promise<Follow | null>
  getAcceptedOrRequestedFollowsWithDomain(
    params: GetAcceptedOrRequestedFollowsWithDomainParams
  ): Promise<Follow[]>
  getAcceptedFollowTargetActorIds(
    params: GetAcceptedFollowTargetActorIdsParams
  ): Promise<string[]>
  getFollowersInbox(params: GetFollowersInboxParams): Promise<string[]>
  // Resolves to whether the status actually changed: false for a missing
  // follow, a concurrent writer that got there first, or the same status.
  updateFollowStatus(params: UpdateFollowStatusParams): Promise<boolean>
  // New method for getting following with pagination
  getFollowing(params: GetFollowingParams): Promise<Follow[]>
  getFollowers(params: GetFollowersParams): Promise<Follow[]>
  // Follow requests methods
  getFollowRequests(params: GetFollowRequestsParams): Promise<Follow[]>
  getFollowRequestsCount(params: GetFollowRequestsCountParams): Promise<number>
}
