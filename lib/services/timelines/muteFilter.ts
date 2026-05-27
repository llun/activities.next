import { Database } from '@/lib/database/types'
import { Status } from '@/lib/types/domain/status'

import { getRelevantStatusActorIds } from './blockFilter'

export const filterMutedStatuses = async (
  database: Database,
  actorId: string | undefined,
  statuses: Status[]
) => {
  if (!actorId) return statuses

  const targetActorIds = [
    ...new Set(statuses.flatMap(getRelevantStatusActorIds))
  ].filter(Boolean)
  if (targetActorIds.length === 0) return statuses

  const relations = await database.getMuteRelations({
    actorIds: [actorId],
    targetActorIds
  })
  if (relations.length === 0) return statuses

  const mutedTargetIds = new Set(
    relations.map((relation) => relation.targetActorId)
  )

  return statuses.filter((status) => {
    const ids = getRelevantStatusActorIds(status)
    return !ids.some((id) => mutedTargetIds.has(id))
  })
}
