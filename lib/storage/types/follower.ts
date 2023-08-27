import { Actor } from '../../models/actor'
import { Follow, FollowStatus } from '../../models/follow'

export type CreateFollowParams = {
  actorId: string
  targetActorId: string
  status: FollowStatus
  inbox: string
  sharedInbox: string
}
export type GetLocalFollowersForActorIdParams = { targetActorId: string }
export type GetLocalActorsFromFollowerUrlParams = { followerUrl: string }
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

export interface FollowerStorage {
  createFollow(params: CreateFollowParams): Promise<Follow>
  getFollowFromId(params: GetFollowFromIdParams): Promise<Follow | undefined>
  getLocalFollowersForActorId(
    params: GetLocalFollowersForActorIdParams
  ): Promise<Follow[]>
  getLocalActorsFromFollowerUrl(
    params: GetLocalActorsFromFollowerUrlParams
  ): Promise<Actor[]>
  getAcceptedOrRequestedFollow(
    params: GetAcceptedOrRequestedFollowParams
  ): Promise<Follow | undefined>
  getFollowersInbox(params: GetFollowersInboxParams): Promise<string[]>
  updateFollowStatus(params: UpdateFollowStatusParams): Promise<void>
}
