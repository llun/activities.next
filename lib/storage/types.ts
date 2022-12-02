import { Actor } from '../models/actor'
import { Attachment } from '../models/attachment'
import { Follow, FollowStatus } from '../models/follow'
import { Status } from '../models/status'

export type IsAccountExistsParams = { email?: string }
export type IsUsernameExistsParams = { username: string }
export type CreateAccountParams = {
  email: string
  username: string
  privateKey: string
  publicKey: string
}
export type GetActorFromEmailParams = { email: string }
export type GetActorFromUsernameParams = { username: string }
export type GetActorFromIdParams = { id: string }
export type IsCurrentActorFollowingParams = {
  currentActorId: string
  followingActorId: string
}
export type GetActorFollowingCountParams = { actorId: string }
export type GetActorFollowersCountParams = { actorId: string }
export type CreateFollowParams = {
  actorId: string
  targetActorId: string
  status: FollowStatus
}
export type GetLocalFollowersForActorIdParams = { targetActorId: string }
export type GetFollowFromIdParams = { followId: string }
export type GetAcceptedOrRequestedFollowParams = {
  actorId: string
  targetActorId: string
}
export type GetFollowersHostsParams = { targetActorId: string }
export type UpdateFollowStatusParams = {
  followId: string
  status: FollowStatus
}
export type CreateStatusParams = { status: Status }
// TODO: Update Status to/cc model to make it easier to filter target
export type GetStatusesParams = { actorId?: string }
export type GetActorStatusesCountParams = { actorId: string }
export type GetActorStatusesParams = { actorId: string }
export type CreateAttachmentParams = {
  statusId: string
  mediaType: string
  url: string
  width: number
  height: number
  name?: string
}
export type GetAttachmentsParams = {
  statusId: string
}

export interface Storage {
  isAccountExists(params: IsAccountExistsParams): Promise<boolean>
  isUsernameExists(params: IsUsernameExistsParams): Promise<boolean>

  createAccount(params: CreateAccountParams): Promise<string>

  getActorFromEmail(params: GetActorFromEmailParams): Promise<Actor | undefined>
  getActorFromUsername(
    params: GetActorFromUsernameParams
  ): Promise<Actor | undefined>
  getActorFromId(params: GetActorFromIdParams): Promise<Actor | undefined>
  isCurrentActorFollowing(
    params: IsCurrentActorFollowingParams
  ): Promise<boolean>
  getActorFollowingCount(params: GetActorFollowingCountParams): Promise<number>
  getActorFollowersCount(params: GetActorFollowersCountParams): Promise<number>

  createFollow(params: CreateFollowParams): Promise<Follow>
  getFollowFromId(params: GetFollowFromIdParams): Promise<Follow | undefined>
  getLocalFollowersForActorId(
    params: GetLocalFollowersForActorIdParams
  ): Promise<Follow[]>
  getAcceptedOrRequestedFollow(
    params: GetAcceptedOrRequestedFollowParams
  ): Promise<Follow | undefined>
  getFollowersHosts(params: GetFollowersHostsParams): Promise<string[]>
  updateFollowStatus(params: UpdateFollowStatusParams): Promise<void>

  createStatus(params: CreateStatusParams): Promise<Status>
  getStatuses(params?: GetStatusesParams): Promise<Status[]>
  getActorStatusesCount(params: GetActorStatusesCountParams): Promise<number>
  getActorStatuses(params: GetActorStatusesParams): Promise<Status[]>

  createAttachment(params: CreateAttachmentParams): Promise<Attachment>
  getAttachments(params: GetAttachmentsParams): Promise<Attachment[]>
}
