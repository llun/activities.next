import { Knex } from 'knex'

import { isPostgresClient } from '@/lib/database/sql/utils/knex'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'

// The subset of targetActorIds that actorId has a follow in one of `statuses`
// for, each id once. `forShare` locks the matching follow rows until the
// caller's transaction ends, on PostgreSQL only: SQLite runs one connection,
// so a read inside a transaction is already atomic with the writes after it.
export const selectFollowTargetActorIds = async (
  database: Knex,
  actorId: string,
  targetActorIds: string[],
  statuses: FollowStatus[],
  { forShare = false }: { forShare?: boolean } = {}
): Promise<string[]> => {
  const uniqueTargetActorIds = [...new Set(targetActorIds)]
  if (uniqueTargetActorIds.length === 0) return []

  const query = database<Follow>('follows')
    .select('targetActorId')
    .where('actorId', actorId)
    .whereIn('status', statuses)
    .whereIn('targetActorId', uniqueTargetActorIds)
  if (forShare && isPostgresClient(database)) query.forShare()
  const follows = await query
  return [...new Set(follows.map((follow) => follow.targetActorId))]
}
