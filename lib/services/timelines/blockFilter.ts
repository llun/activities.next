import { Database } from '@/lib/database/types'
import { Status, StatusType } from '@/lib/types/domain/status'

export const getRelevantStatusActorIds = (status: Status) => [
  status.actorId,
  ...(status.type === StatusType.enum.Announce
    ? [status.originalStatus.actorId]
    : [])
]

export const filterBlockedStatuses = async (
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
  const statusActorIds = [
    ...new Set([...statusActorIdsByStatus.values()].flat())
  ]
  const relations = await database.getBlockRelations({
    actorIds: [actorId],
    targetActorIds: statusActorIds
  })
  const blockedStatusActorIds = new Set(
    relations.map((relation) =>
      relation.actorId === actorId ? relation.targetActorId : relation.actorId
    )
  )

  return statuses.filter((status) => {
    const actorIds = statusActorIdsByStatus.get(status.id) ?? []
    return !actorIds.some((statusActorId) =>
      blockedStatusActorIds.has(statusActorId)
    )
  })
}

export const getBlockedRecipientActorIdsForStatus = async (
  database: Database,
  recipientActorIds: string[],
  status: Status
) => {
  const actorIds = [...new Set(recipientActorIds)]
  const statusActorIds = [...new Set(getRelevantStatusActorIds(status))]
  const actorIdSet = new Set(actorIds)
  const statusActorIdSet = new Set(statusActorIds)

  const relations = await database.getBlockRelations({
    actorIds,
    targetActorIds: statusActorIds
  })

  return new Set(
    relations.flatMap((relation) => {
      if (
        actorIdSet.has(relation.actorId) &&
        statusActorIdSet.has(relation.targetActorId)
      ) {
        return [relation.actorId]
      }
      if (
        actorIdSet.has(relation.targetActorId) &&
        statusActorIdSet.has(relation.actorId)
      ) {
        return [relation.targetActorId]
      }
      return []
    })
  )
}
