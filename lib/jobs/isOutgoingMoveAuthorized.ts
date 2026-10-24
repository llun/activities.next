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
  const migrations = await database.getActorMigrations({ actorId: origin.id })
  return migrations.some(
    (migration) =>
      migration.kind === 'move' &&
      (!migrationId || migration.id === migrationId) &&
      actorIdsMatch(migration.targetActorId, targetActorId) &&
      (migration.startedAt !== null || pointerMatches)
  )
}
