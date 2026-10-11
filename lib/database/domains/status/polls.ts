import type {
  GetActorPollVotesForStatusesParams,
  GetActorPollVotesParams,
  HasActorVotedParams
} from '@/lib/database/domains/status/types'
import type { Db } from '@/lib/database/kysely'
import { selectInChunks } from '@/lib/database/kysely/inList'

// The poll reads: whether an actor voted and which choices. The poll writes
// (recordPollVotes, createPollAnswer, incrementPollChoiceVotes) are still the
// Knex mixin in lib/database/sql/status.ts.

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
