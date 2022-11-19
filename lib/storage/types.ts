import { Actor } from '../models/actor'
import { Follow, FollowStatus } from '../models/follow'
import { Status } from '../models/status'

export interface Storage {
  isAccountExists(params: { email?: string | null }): Promise<boolean>
  isUsernameExists(params: { username: string }): Promise<boolean>

  createAccount(params: {
    email: string
    username: string
    privateKey: string
    publicKey: string
  }): Promise<string>

  getActorFromEmail(params: { email: string }): Promise<Actor | undefined>
  getActorFromUsername(params: { username: string }): Promise<Actor | undefined>
  getActorFromId(params: { id: string }): Promise<Actor | undefined>
  isCurrentActorFollowing(params: {
    currentActorId: string
    followingActorId: string
  }): Promise<boolean>
  getActorFollowingCount(params: { actorId: string }): Promise<number>
  getActorFollowersCount(params: { actorId: string }): Promise<number>

  createFollow(params: {
    actorId: string
    targetActorId: string
    status: FollowStatus
  }): Promise<Follow>
  getFollowFromId(params: { followId: string }): Promise<Follow | undefined>
  getAcceptedOrRequestedFollow(params: {
    actorId: string
    targetActorId: string
  }): Promise<Follow | undefined>
  getFollowersHosts(params: { targetActorId: string }): Promise<string[]>
  updateFollowStatus(params: {
    followId: string
    status: FollowStatus
  }): Promise<void>

  createStatus(params: { status: Status }): Promise<Status>
  getStatuses(params?: { actorId?: string }): Promise<Status[]>
  getActorStatusesCount(params: { actorId: string }): Promise<number>
}
