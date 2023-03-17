import { Account } from '../models/account'
import { Actor } from '../models/actor'
import { Attachment } from '../models/attachment'
import { Follow, FollowStatus } from '../models/follow'
import { Status } from '../models/status'
import { Tag } from '../models/tag'
import { Timeline } from '../timelines/types'

export type IsAccountExistsParams = { email: string }
export type IsUsernameExistsParams = { username: string; domain: string }
export type CreateAccountParams = {
  email: string
  username: string
  domain: string
  privateKey: string
  publicKey: string
}
export type GetAccountFromIdParams = { id: string }

export type CreateActorParams = {
  actorId: string

  username: string
  domain: string
  name?: string
  summary?: string
  iconUrl?: string
  headerImageUrl?: string

  inboxUrl: string
  sharedInboxUrl: string
  followersUrl: string

  publicKey: string
  privateKey?: string

  createdAt: number
}
export type GetActorFromEmailParams = { email: string }
export type GetActorFromUsernameParams = { username: string; domain: string }
export type GetActorFromIdParams = { id: string }
export type IsCurrentActorFollowingParams = {
  currentActorId: string
  followingActorId: string
}
export type UpdateActorParams = {
  actorId: string

  name?: string
  summary?: string
  iconUrl?: string
  headerImageUrl?: string
  appleSharedAlbumToken?: string

  publicKey?: string

  followersUrl?: string
  inboxUrl?: string
  sharedInboxUrl?: string
}
export type DeleteActorParams = {
  actorId: string
}
export type GetActorFollowingCountParams = { actorId: string }
export type GetActorFollowersCountParams = { actorId: string }
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
export type CreateNoteParams = {
  id: string
  actorId: string
  url: string
  text: string
  summary?: string

  to: string[]
  cc: string[]

  reply?: string

  createdAt?: number
}
export type CreateAnnounceParams = {
  id: string
  actorId: string

  to: string[]
  cc: string[]

  originalStatusId: string
  createdAt?: number
}
export type CreatePollParams = {
  id: string
  actorId: string
  url: string
  text: string
  summary?: string

  to: string[]
  cc: string[]

  choices: string[]

  reply?: string

  endAt: number
  createdAt?: number
}
export type GetStatusParams = { statusId: string; withReplies?: boolean }
export type GetStatusRepliesParams = { statusId: string }
export type GetActorStatusesCountParams = { actorId: string }
export type GetActorStatusesParams = { actorId: string }
export type DeleteStatusParams = { statusId: string }
export type HasActorAnnouncedStatusParams = {
  statusId: string
  actorId?: string
}

export type GetTimelineParams = {
  timeline: Timeline
  actorId?: string
  startAfterStatusId?: string
}
export type CreateTimelineStatusParams = {
  timeline: Timeline
  actorId: string
  status: Status
}

export type CreateAttachmentParams = {
  statusId: string
  mediaType: string
  url: string
  width?: number
  height?: number
  name?: string
}
export type GetAttachmentsParams = {
  statusId: string
}

export type TagType = 'emoji' | 'mention'
export type CreateTagParams = {
  statusId: string
  name: string
  type: TagType
  value?: string
}
export type GetTagsParams = {
  statusId: string
}

export type CreateLikeParams = {
  actorId: string
  statusId: string
}
export type DeleteLikeParams = {
  actorId: string
  statusId: string
}
export type GetLikeCountParams = {
  statusId: string
}

export interface Storage {
  isAccountExists(params: IsAccountExistsParams): Promise<boolean>
  isUsernameExists(params: IsUsernameExistsParams): Promise<boolean>

  createAccount(params: CreateAccountParams): Promise<string>
  getAccountFromId(params: GetAccountFromIdParams): Promise<Account | undefined>

  createActor(params: CreateActorParams): Promise<Actor | undefined>
  getActorFromEmail(params: GetActorFromEmailParams): Promise<Actor | undefined>
  getActorFromUsername(
    params: GetActorFromUsernameParams
  ): Promise<Actor | undefined>
  getActorFromId(params: GetActorFromIdParams): Promise<Actor | undefined>
  updateActor(params: UpdateActorParams): Promise<Actor | undefined>
  deleteActor(params: DeleteActorParams): Promise<void>

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
  getLocalActorsFromFollowerUrl(
    params: GetLocalActorsFromFollowerUrlParams
  ): Promise<Actor[]>
  getAcceptedOrRequestedFollow(
    params: GetAcceptedOrRequestedFollowParams
  ): Promise<Follow | undefined>
  getFollowersInbox(params: GetFollowersInboxParams): Promise<string[]>
  updateFollowStatus(params: UpdateFollowStatusParams): Promise<void>

  createNote(params: CreateNoteParams): Promise<Status>
  createAnnounce(params: CreateAnnounceParams): Promise<Status | undefined>
  createPoll(params: CreatePollParams): Promise<Status>
  getStatus(params: GetStatusParams): Promise<Status | undefined>
  getStatusReplies(params: GetStatusRepliesParams): Promise<Status[]>
  hasActorAnnouncedStatus(
    params: HasActorAnnouncedStatusParams
  ): Promise<boolean>

  getActorStatusesCount(params: GetActorStatusesCountParams): Promise<number>
  getActorStatuses(params: GetActorStatusesParams): Promise<Status[]>
  deleteStatus(params: DeleteStatusParams): Promise<void>

  getTimeline(params: GetTimelineParams): Promise<Status[]>
  createTimelineStatus(params: CreateTimelineStatusParams): Promise<void>

  createAttachment(params: CreateAttachmentParams): Promise<Attachment>
  getAttachments(params: GetAttachmentsParams): Promise<Attachment[]>

  createTag(params: CreateTagParams): Promise<Tag>
  getTags(params: GetTagsParams): Promise<Tag[]>

  createLike(params: CreateLikeParams): Promise<void>
  deleteLike(params: DeleteLikeParams): Promise<void>
  getLikeCount(params: GetLikeCountParams): Promise<number>

  destroy(): Promise<void>
}
