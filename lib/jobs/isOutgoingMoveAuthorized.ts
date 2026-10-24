import type { Database } from '@/lib/database/types'
import { actorIdsMatch } from '@/lib/utils/activitypub'

// Mastodon never stops a performed move: DELETE only clears the pointer. The
// recorded migration authorizes the work, so a cleared `movedTo` after the
// start does not strand followers. Before `startedAt` is set (the start job can
// run first) the live pointer still has to name the target, so a cancel in that
// window stops it.
export const isOutgoingMoveAuthorized = async (
  database: Database,
  origin: { id: string; movedTo?: string | null },
  targetActorId: string,
  migrationId?: string
): Promise<boolean> => {
  const pointerMatches = Boolean(
    origin.movedTo && actorIdsMatch(origin.movedTo, targetActorId)
  )
  // A job without the migration id (or a stale one) is never authorized: an
  // older started move to the same target must not cover a newer cancelled one.
  if (!migrationId) return false
  const migration = await database.getActorMigration({
    id: migrationId,
    actorId: origin.id
  })
  return Boolean(
    migration &&
    migration.kind === 'move' &&
    actorIdsMatch(migration.targetActorId, targetActorId) &&
    (migration.startedAt !== null || pointerMatches)
  )
}
