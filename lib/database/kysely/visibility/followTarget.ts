import type { Db } from '@/lib/database/kysely'
import { forShare } from '@/lib/database/kysely/dialect'
import type { FollowStatus } from '@/lib/types/domain/follow'

// The subset of targetActorIds that actorId has a follow in one of `statuses`
// for, each id once, in the order the rows come back. `forShare` locks the
// matching follow rows until the caller's transaction ends, on PostgreSQL only
// (see forShare in dialect.ts): SQLite runs one connection, so a read inside a
// transaction is already atomic with the writes after it. visibility.test.ts
// pins what it finds.
export const selectFollowTargetActorIds = async (
  db: Db,
  actorId: string,
  targetActorIds: string[],
  statuses: FollowStatus[],
  { forShare: lockRows = false }: { forShare?: boolean } = {}
): Promise<string[]> => {
  const uniqueTargetActorIds = [...new Set(targetActorIds)]
  // An empty list selects nothing; `in ()` is a syntax error on PostgreSQL.
  if (uniqueTargetActorIds.length === 0 || statuses.length === 0) return []

  const query = db
    .selectFrom('follows')
    .select('targetActorId')
    .where('actorId', '=', actorId)
    .where('status', 'in', statuses)
    .where('targetActorId', 'in', uniqueTargetActorIds)
  const follows = await (lockRows ? forShare(db, query) : query).execute()
  // The `in` list matched each row's targetActorId, so none is NULL.
  return [...new Set(follows.map((follow) => follow.targetActorId as string))]
}
