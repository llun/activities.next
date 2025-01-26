import { Actor } from '@/lib/models/actor'
import { Status } from '@/lib/models/status'
import { Tag, TagType } from '@/lib/models/tag'

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

type BaseStatusParams = {
  statusId: string
}

export type UpdateNoteParams = Pick<CreateNoteParams, 'text' | 'summary'> &
  BaseStatusParams

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
export type UpdatePollParams = Pick<CreatePollParams, 'text' | 'summary'> &
  BaseStatusParams & {
    choices: { title: string; totalVotes: number }[]
  }

export type GetStatusParams = BaseStatusParams & {
  currentActorId?: string
  withReplies?: boolean
}
export type GetStatusRepliesParams = BaseStatusParams
export type GetActorStatusesCountParams = { actorId: string }
export type GetActorStatusesParams = { actorId: string }
export type DeleteStatusParams = BaseStatusParams
export type HasActorAnnouncedStatusParams = BaseStatusParams & {
  actorId?: string
}
export type GetFavouritedByParams = BaseStatusParams

export type CreateTagParams = {
  statusId: string
  name: string
  type: TagType
  value?: string
}
export type GetTagsParams = {
  statusId: string
}

export interface StatusDatabase {
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

  getFavouritedBy(params: GetFavouritedByParams): Promise<Actor[]>

  createTag(params: CreateTagParams): Promise<Tag>
  getTags(params: GetTagsParams): Promise<Tag[]>
}
