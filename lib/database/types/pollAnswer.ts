import { PollAnswer } from '@/lib/models/pollAnswer'

export interface CreatePollAnswerParams {
  actorId: string
  choiceId: number
}

export interface GetActorPollAnswersParams {
  actorId: string
  statusId: string
}

export interface HasActorVotedOnPollParams {
  actorId: string
  statusId: string
}

export interface DeletePollAnswerParams {
  actorId: string
  choiceId: number
}

export interface GetPollAnswersByStatusParams {
  statusId: string
}

export interface GetPollAnswersByChoiceParams {
  choiceId: number
}

export interface PollAnswerDatabase {
  createPollAnswer(params: CreatePollAnswerParams): Promise<PollAnswer>
  getActorPollAnswers(
    params: GetActorPollAnswersParams
  ): Promise<PollAnswer[]>
  hasActorVotedOnPoll(params: HasActorVotedOnPollParams): Promise<boolean>
  deletePollAnswer(params: DeletePollAnswerParams): Promise<boolean>
  getPollAnswersByStatus(
    params: GetPollAnswersByStatusParams
  ): Promise<PollAnswer[]>
  getPollAnswersByChoice(
    params: GetPollAnswersByChoiceParams
  ): Promise<PollAnswer[]>
}
