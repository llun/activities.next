import { Knex } from 'knex'

import { Follow, FollowStatus } from '@/lib/types/domain/follow'

// The subset of targetActorIds that actorId has a follow in one of `statuses`
// for, each id once.
export const selectFollowTargetActorIds = async (
  database: Knex,
  actorId: string,
  targetActorIds: string[],
  statuses: FollowStatus[]
): Promise<string[]> => {
  const uniqueTargetActorIds = [...new Set(targetActorIds)]
  if (uniqueTargetActorIds.length === 0) return []

  const follows = await database<Follow>('follows')
    .select('targetActorId')
    .where('actorId', actorId)
    .whereIn('status', statuses)
    .whereIn('targetActorId', uniqueTargetActorIds)
  return [...new Set(follows.map((follow) => follow.targetActorId))]
}
