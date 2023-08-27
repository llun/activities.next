import { Status } from '../../models/status'

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

export interface StatusStorage {
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
}
