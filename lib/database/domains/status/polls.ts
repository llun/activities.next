import type {
  CreatePollAnswerParams,
  GetActorPollVotesForStatusesParams,
  GetActorPollVotesParams,
  HasActorVotedParams,
  IncrementPollChoiceVotesParams,
  RecordPollVotesParams
} from '@/lib/database/domains/status/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { selectInChunks } from '@/lib/database/kysely/inList'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'

// The poll votes: whether an actor voted and which choices, and the vote
// writes. A poll's choices and their tallies are written with the poll
// (./writes.ts, ./edits.ts).

export const hasActorVoted = async (
  db: Db,
  { statusId, actorId }: HasActorVotedParams
): Promise<boolean> => {
  const row = await db
    .selectFrom('poll_answers')
    .selectAll()
    .where('statusId', '=', statusId)
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  return Boolean(row)
}

// The choice indexes `actorId` voted for, in the order the database returns
// them (no ORDER BY, as before).
export const getActorPollVotes = async (
  db: Db,
  { statusId, actorId }: GetActorPollVotesParams
): Promise<number[]> => {
  const rows = await db
    .selectFrom('poll_answers')
    .select('choice')
    .where('statusId', '=', statusId)
    .where('actorId', '=', actorId)
    .execute()
  return rows.map((row) => row.choice)
}

// Every requested status gets an entry, empty when the actor did not vote.
export const getActorPollVotesForStatuses = async (
  db: Db,
  { statusIds, actorId }: GetActorPollVotesForStatusesParams
): Promise<Record<string, number[]>> => {
  const uniqueStatusIds = [...new Set(statusIds)]
  const votesByStatusId = Object.fromEntries(
    uniqueStatusIds.map((statusId) => [statusId, []])
  ) as Record<string, number[]>

  // One value of each statement is the actorId.
  const rows = await selectInChunks(
    db,
    uniqueStatusIds,
    (chunk) =>
      db
        .selectFrom('poll_answers')
        .select(['statusId', 'choice'])
        .where('actorId', '=', actorId)
        .where('statusId', 'in', chunk)
        .orderBy('statusId', 'asc')
        .orderBy('choice', 'asc')
        .execute(),
    1
  )
  for (const row of rows) {
    votesByStatusId[row.statusId]?.push(Number(row.choice))
  }

  return votesByStatusId
}

// Records `actorId`'s votes for the choices at the given indexes (in choiceId
// order) and adds one to each choice's tally, in one transaction. False, with
// nothing written, when there is no choice at an index, when the actor already
// voted (unless `allowAdditionalChoices`, which records only the choices the
// actor has not voted for yet), or when a concurrent vote of the same actor
// wins the voter row's unique key.
export const recordPollVotes = async (
  db: Db,
  {
    statusId,
    actorId,
    choices,
    allowAdditionalChoices = false
  }: RecordPollVotesParams
): Promise<boolean> => {
  const uniqueChoices = [...new Set(choices)]
  if (uniqueChoices.length === 0) return false

  const currentTime = new Date()
  try {
    return await inTransaction(db, async (trx) => {
      const pollChoices = await trx
        .selectFrom('poll_choices')
        .select('choiceId')
        .where('statusId', '=', statusId)
        .orderBy('choiceId', 'asc')
        .execute()
      const selectedChoices: { choiceIndex: number; choiceId: number }[] = []
      for (const choiceIndex of uniqueChoices) {
        const choice = pollChoices[choiceIndex]
        if (!choice) return false
        selectedChoices.push({
          choiceIndex,
          choiceId: choice.choiceId
        })
      }

      const existingVote = await trx
        .selectFrom('poll_voters')
        .select('id')
        .where('statusId', '=', statusId)
        .where('actorId', '=', actorId)
        .limit(1)
        .executeTakeFirst()
      if (existingVote && !allowAdditionalChoices) return false

      const existingAnswers = allowAdditionalChoices
        ? await trx
            .selectFrom('poll_answers')
            .select('choice')
            .where('statusId', '=', statusId)
            .where('actorId', '=', actorId)
            .where('choice', 'in', uniqueChoices)
            .execute()
        : []
      const existingChoices = new Set(
        existingAnswers.map((answer) => answer.choice)
      )
      const newSelectedChoices = selectedChoices.filter(
        (choice) => !existingChoices.has(choice.choiceIndex)
      )
      if (newSelectedChoices.length === 0) return false

      if (!existingVote) {
        await trx
          .insertInto('poll_voters')
          .values({
            statusId,
            actorId,
            createdAt: currentTime,
            updatedAt: currentTime
          })
          .execute()
      }

      await trx
        .insertInto('poll_answers')
        .values(
          newSelectedChoices.map((choice) => ({
            statusId,
            actorId,
            choice: choice.choiceIndex,
            createdAt: currentTime,
            updatedAt: currentTime
          }))
        )
        .execute()

      await trx
        .updateTable('poll_choices')
        .set((eb) => ({ totalVotes: eb('totalVotes', '+', 1) }))
        .where('statusId', '=', statusId)
        .where(
          'choiceId',
          'in',
          newSelectedChoices.map((choice) => choice.choiceId)
        )
        .execute()

      return true
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

export const createPollAnswer = async (
  db: Db,
  { statusId, actorId, choice }: CreatePollAnswerParams
): Promise<void> => {
  const currentTime = new Date()
  await db
    .insertInto('poll_answers')
    .values({
      statusId,
      actorId,
      choice,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()
}

// Adds one to the tally of the choice at `choiceIndex` (in choiceId order);
// nothing when there is none.
export const incrementPollChoiceVotes = async (
  db: Db,
  { statusId, choiceIndex }: IncrementPollChoiceVotesParams
): Promise<void> => {
  // Knex read the index through parseInt, ignored a NaN one (the first choice)
  // and refused a negative one before any query; the same rules here, so the
  // database never sees an index Knex would not have sent (SQLite reads a
  // negative offset as none, which would tally the first choice).
  const offset = Number.parseInt(String(choiceIndex), 10)
  if (offset < 0) {
    throw new Error('A non-negative integer must be provided to offset.')
  }
  let query = db
    .selectFrom('poll_choices')
    .select('choiceId')
    .where('statusId', '=', statusId)
    .orderBy('choiceId', 'asc')
    .limit(1)
  if (!Number.isNaN(offset)) query = query.offset(offset)
  const choice = await query.executeTakeFirst()
  if (!choice) return

  await db
    .updateTable('poll_choices')
    .set((eb) => ({ totalVotes: eb('totalVotes', '+', 1) }))
    .where('statusId', '=', statusId)
    .where('choiceId', '=', choice.choiceId)
    .execute()
}
