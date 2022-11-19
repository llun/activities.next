import { Actor } from '../models/actor'
import { Follow } from '../models/follow'
import { Status } from '../models/status'

export interface Storage {
  isAccountExists(email?: string | null): Promise<boolean>
  isUsernameExists(username: string): Promise<boolean>

  createAccount(params: {
    email: string
    username: string
    privateKey: string
    publicKey: string
  }): Promise<string>

  getActorFromEmail(email: string): Promise<Actor | undefined>
  getActorFromUsername(username: string): Promise<Actor | undefined>
  getActorFromId(id: string): Promise<Actor | undefined>
  isCurrentActorFollowing(
    currentActorId: string,
    followingActorId: string
  ): Promise<boolean>
  getActorFollowingCount(actorId: string): Promise<number>
  getActorFollowersCount(actorId: string): Promise<number>

  createFollow(actorId: string, targetActorId: string): Promise<Follow>
  getFollowFromId(followId: string): Promise<Follow | undefined>
  getAcceptedOrRequestedFollow(
    actorId: string,
    targetActorId: string
  ): Promise<Follow | undefined>
  updateFollowStatus(
    followId: string,
    status: 'Requested' | 'Accepted' | 'Rejected' | 'Undo'
  ): Promise<void>

  createStatus(status: Status): Promise<void>
  getStatuses(params?: { actorId?: string }): Promise<Status[]>
}
