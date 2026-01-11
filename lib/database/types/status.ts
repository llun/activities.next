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
  pollType?: 'oneOf' | 'anyOf'
}
export type UpdatePollParams = Pick<CreatePollParams, 'text' | 'summary'> &
  BaseStatusParams & {
    choices: { title: string; totalVotes: number }[]
  }

export type GetStatusParams = BaseStatusParams & {
  currentActorId?: string
  withReplies?: boolean
}
export type GetStatusRepliesParams = BaseStatusParams & {
  url?: string
}
export type GetActorStatusesCountParams = { actorId: string }
export type GetActorStatusesParams = {
  actorId: string
  minStatusId?: string | null
  maxStatusId?: string | null
  limit?: number
}
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
export type GetStatusReblogsCountParams = {
  statusId: string
}

export type CreatePollAnswerParams = {
  statusId: string
  actorId: string
  choice: number
}

export type HasActorVotedParams = {
  statusId: string
  actorId: string
}

export type GetActorPollVotesParams = {
  statusId: string
  actorId: string
}

export type IncrementPollChoiceVotesParams = {
  statusId: string
  choiceIndex: number
}

export interface StatusDatabase {
  createNote(params: CreateNoteParams): Promise<Status>
  updateNote(params: UpdateNoteParams): Promise<Status | null>

  createAnnounce(params: CreateAnnounceParams): Promise<Status | null>

  createPoll(params: CreatePollParams): Promise<Status>
  updatePoll(params: UpdatePollParams): Promise<Status | null>

  getStatus(params: GetStatusParams): Promise<Status | null>
  getStatusReplies(params: GetStatusRepliesParams): Promise<Status[]>

  hasActorAnnouncedStatus(
    params: HasActorAnnouncedStatusParams
  ): Promise<boolean>

  getActorAnnounceStatus(
    params: HasActorAnnouncedStatusParams
  ): Promise<Status | null>

  getActorStatusesCount(params: GetActorStatusesCountParams): Promise<number>
  getActorStatuses(params: GetActorStatusesParams): Promise<Status[]>
  deleteStatus(params: DeleteStatusParams): Promise<void>

  getFavouritedBy(params: GetFavouritedByParams): Promise<Actor[]>

  createTag(params: CreateTagParams): Promise<Tag>
  getTags(params: GetTagsParams): Promise<Tag[]>

  getStatusReblogsCount(params: GetStatusReblogsCountParams): Promise<number>

  createPollAnswer(params: CreatePollAnswerParams): Promise<void>
  hasActorVoted(params: HasActorVotedParams): Promise<boolean>
  getActorPollVotes(params: GetActorPollVotesParams): Promise<number[]>
  incrementPollChoiceVotes(
    params: IncrementPollChoiceVotesParams
  ): Promise<void>
}
