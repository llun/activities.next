import { Database } from '@/lib/database/types'
import { Status, StatusType } from '@/lib/types/domain/status'

const getRelevantStatusActorIds = (status: Status) => [
  status.actorId,
  ...(status.type === StatusType.enum.Announce
    ? [status.originalStatus.actorId]
    : [])
]

export const isStatusBlockedForActor = async (
  database: Database,
  actorId: string,
  status: Status
) => {
  const actorIds = [...new Set(getRelevantStatusActorIds(status))]
  for (const statusActorId of actorIds) {
    if (
      await database.isEitherBlocking({
        actorIdA: actorId,
        actorIdB: statusActorId
      })
    ) {
      return true
    }
  }
  return false
}

export const filterBlockedStatuses = async (
  database: Database,
  actorId: string | undefined,
  statuses: Status[]
) => {
  if (!actorId) return statuses

  const visibility = await Promise.all(
    statuses.map(async (status) => ({
      status,
      blocked: await isStatusBlockedForActor(database, actorId, status)
    }))
  )

  return visibility
    .filter(({ blocked }) => !blocked)
    .map(({ status }) => status)
}
