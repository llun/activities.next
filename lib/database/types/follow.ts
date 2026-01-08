import { Actor } from '@/lib/models/actor'
import { Follow, FollowStatus } from '@/lib/models/follow'

export type CreateFollowParams = {
  actorId: string
  targetActorId: string
  status: FollowStatus
  inbox: string
  sharedInbox: string
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
  minId?: string | null
}
export type GetFollowersParams = {
  targetActorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
}
export type GetFollowRequestsParams = {
  targetActorId: string
  limit: number
  offset?: number
}
export type GetFollowRequestsCountParams = {
  targetActorId: string
}

export interface FollowDatabase {
  createFollow(params: CreateFollowParams): Promise<Follow>
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
  getFollowersInbox(params: GetFollowersInboxParams): Promise<string[]>
  updateFollowStatus(params: UpdateFollowStatusParams): Promise<void>
  // New method for getting following with pagination
  getFollowing(params: GetFollowingParams): Promise<Follow[]>
  getFollowers(params: GetFollowersParams): Promise<Follow[]>
  // Follow requests methods
  getFollowRequests(params: GetFollowRequestsParams): Promise<Follow[]>
  getFollowRequestsCount(params: GetFollowRequestsCountParams): Promise<number>
}
