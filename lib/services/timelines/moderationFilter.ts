import { Database } from '@/lib/database/types'
import { Status } from '@/lib/types/domain/status'

import { getRelevantStatusActorIds } from './blockFilter'

// Drop statuses authored (or, for Announce, boosted) by a moderated actor.
// Suspended authors are dropped on every surface; silenced authors are dropped
// only when `includeSilenced` is false (i.e. on public/tag/federated surfaces —
// a follower's home timeline keeps them). Both the announcing actor and the
// announced original author are checked, mirroring the block/mute filters.
export const filterModeratedStatuses = async (
  database: Database,
  statuses: Status[],
  includeSilenced: boolean
): Promise<Status[]> => {
  if (statuses.length === 0) return statuses

  const actorIds = [
    ...new Set(statuses.flatMap(getRelevantStatusActorIds))
  ].filter(Boolean)
  if (actorIds.length === 0) return statuses

  const states = await database.getModerationStatesForActors({ actorIds })
  if (states.size === 0) return statuses

  return statuses.filter((status) => {
    const ids = getRelevantStatusActorIds(status)
    return !ids.some((id) => {
      const state = states.get(id)
      if (!state) return false
      if (state.suspendedAt) return true
      if (state.silencedAt && !includeSilenced) return true
      return false
    })
  })
}
