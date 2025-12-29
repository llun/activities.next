import { Knex } from 'knex'

import {
  CreatePollAnswerParams,
  DeletePollAnswerParams,
  GetActorPollAnswersParams,
  GetPollAnswersByChoiceParams,
  GetPollAnswersByStatusParams,
  HasActorVotedOnPollParams,
  PollAnswerDatabase
} from '@/lib/database/types/pollAnswer'
import { PollAnswer } from '@/lib/models/pollAnswer'

import { getCompatibleTime } from './utils/getCompatibleTime'

export const PollAnswerSQLDatabaseMixin = (
  database: Knex
): PollAnswerDatabase => {
  /**
   * Create a new poll answer (vote)
   * Throws error if actor has already voted on this choice
   */
  async function createPollAnswer({
    actorId,
    choiceId
  }: CreatePollAnswerParams): Promise<PollAnswer> {
    const currentTime = new Date()

    // Check if actor has already voted on this choice
    const existingVote = await database('poll_answers')
      .where('choice', choiceId)
      .andWhere('actorId', actorId)
      .first()

    if (existingVote) {
      throw new Error('Actor has already voted on this choice')
    }

    // Create the vote
    const [answerId] = await database('poll_answers').insert({
      choice: choiceId,
      actorId,
      createdAt: currentTime,
      updatedAt: currentTime
    })

    return PollAnswer.parse({
      answerId,
      choice: choiceId,
      actorId,
      createdAt: getCompatibleTime(currentTime),
      updatedAt: getCompatibleTime(currentTime)
    })
  }

  /**
   * Get all answers (votes) by an actor for a specific poll
   */
  async function getActorPollAnswers({
    actorId,
    statusId
  }: GetActorPollAnswersParams): Promise<PollAnswer[]> {
    const raw = await database('poll_answers')
      .join('poll_choices', 'poll_answers.choice', 'poll_choices.choiceId')
      .where('poll_answers.actorId', actorId)
      .andWhere('poll_choices.statusId', statusId)
      .select('poll_answers.*')

    return raw.map((data) =>
      PollAnswer.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    )
  }

  /**
   * Check if an actor has voted on a specific poll
   */
  async function hasActorVotedOnPoll({
    actorId,
    statusId
  }: HasActorVotedOnPollParams): Promise<boolean> {
    const result = await database('poll_answers')
      .join('poll_choices', 'poll_answers.choice', 'poll_choices.choiceId')
      .where('poll_answers.actorId', actorId)
      .andWhere('poll_choices.statusId', statusId)
      .first()

    return Boolean(result)
  }

  /**
   * Delete a poll answer (remove vote)
   * Returns true if vote was deleted, false if no vote existed
   */
  async function deletePollAnswer({
    actorId,
    choiceId
  }: DeletePollAnswerParams): Promise<boolean> {
    const deleted = await database('poll_answers')
      .where('choice', choiceId)
      .andWhere('actorId', actorId)
      .delete()

    return deleted > 0
  }

  /**
   * Get all answers for a specific poll (by statusId)
   */
  async function getPollAnswersByStatus({
    statusId
  }: GetPollAnswersByStatusParams): Promise<PollAnswer[]> {
    const raw = await database('poll_answers')
      .join('poll_choices', 'poll_answers.choice', 'poll_choices.choiceId')
      .where('poll_choices.statusId', statusId)
      .select('poll_answers.*')

    return raw.map((data) =>
      PollAnswer.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    )
  }

  /**
   * Get all answers for a specific choice
   */
  async function getPollAnswersByChoice({
    choiceId
  }: GetPollAnswersByChoiceParams): Promise<PollAnswer[]> {
    const raw = await database('poll_answers').where('choice', choiceId)

    return raw.map((data) =>
      PollAnswer.parse({
        ...data,
        createdAt: getCompatibleTime(data.createdAt),
        updatedAt: getCompatibleTime(data.updatedAt)
      })
    )
  }

  return {
    createPollAnswer,
    getActorPollAnswers,
    hasActorVotedOnPoll,
    deletePollAnswer,
    getPollAnswersByStatus,
    getPollAnswersByChoice
  }
}
