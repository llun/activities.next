import { Database } from '@/lib/database/types'
import { Status } from '@/lib/types/domain/status'

import { getRelevantStatusActorIds } from './blockFilter'

export const filterMutedStatuses = async (
  database: Database,
  actorId: string | undefined,
  statuses: Status[]
) => {
  if (!actorId) return statuses

  const statusActorIdsByStatus = new Map(
    statuses.map((status) => [
      status.id,
      [...new Set(getRelevantStatusActorIds(status))]
    ])
  )
  const targetActorIds = [
    ...new Set([...statusActorIdsByStatus.values()].flat())
  ].filter(Boolean)
  if (targetActorIds.length === 0) return statuses

  const relations = await database.getMuteRelations({
    actorIds: [actorId],
    targetActorIds
  })
  const mutedTargetIds = new Set(
    relations.map((relation) => relation.targetActorId)
  )

  return statuses.filter((status) => {
    const ids = statusActorIdsByStatus.get(status.id) ?? []
    return !ids.some((id) => mutedTargetIds.has(id))
  })
}
