import { Actor } from '../models/actor'
import { Attachment } from '../models/attachment'
import { Follow, FollowStatus } from '../models/follow'
import { Status } from '../models/status'
import { Tag } from '../models/tag'
import { Timeline } from '../timelines/types'
import { AccountStorage } from './types/acount'
import { ActorStorage } from './types/actor'
import { LikeStorage } from './types/like'
import { MediaStorage } from './types/media'

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

interface BaseCreateStatusParams {
  id: string
  actorId: string
  to: string[]
  cc: string[]

  url: string
  text: string
  summary?: string | null
  reply?: string

  createdAt?: number
}

export type CreateNoteParams = BaseCreateStatusParams
export type UpdateNoteParams = Pick<CreateNoteParams, 'text' | 'summary'> & {
  statusId: string
}

export type CreateAnnounceParams = Pick<
  BaseCreateStatusParams,
  'id' | 'actorId' | 'to' | 'cc' | 'createdAt'
> & {
  originalStatusId: string
}

export type CreatePollParams = BaseCreateStatusParams & {
  choices: string[]
  endAt: number
}
export type UpdatePollParams = Pick<CreatePollParams, 'text' | 'summary'> & {
  statusId: string
  choices: { title: string; totalVotes: number }[]
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

export interface Storage
  extends AccountStorage,
    ActorStorage,
    LikeStorage,
    MediaStorage {
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
  updateNote(params: UpdateNoteParams): Promise<Status | undefined>

  createAnnounce(params: CreateAnnounceParams): Promise<Status | undefined>

  createPoll(params: CreatePollParams): Promise<Status>
  updatePoll(params: UpdatePollParams): Promise<Status | undefined>

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

  destroy(): Promise<void>
}
