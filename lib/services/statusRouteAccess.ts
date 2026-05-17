import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import { type Status, StatusType } from '@/lib/types/domain/status'

import { canActorReadStatus, isStatusPubliclyReadable } from './statusAccess'

interface GetReadableStatusParams {
  database: Database
  statusId: string
  currentActor: Actor | null
  withReplies?: boolean
}

export const getReadableStatus = async ({
  database,
  statusId,
  currentActor,
  withReplies
}: GetReadableStatusParams) => {
  const status = await database.getStatus({
    statusId,
    currentActorId: currentActor?.id,
    ...(withReplies === undefined ? {} : { withReplies })
  })
  if (!status) return null

  const hasAccess = await canActorReadStatus({
    database,
    status,
    currentActor
  })
  return hasAccess ? status : null
}

const addStatusActorIds = (status: Status, actorIds: Set<string>) => {
  actorIds.add(status.actorId)
  if (status.type === StatusType.enum.Announce) {
    addStatusActorIds(status.originalStatus, actorIds)
  }
}

const getFollowerStateByActorId = async ({
  database,
  statuses,
  currentActor
}: {
  database: Database
  statuses: Status[]
  currentActor: Actor
}): Promise<Map<string, boolean>> => {
  const actorIds = new Set<string>()
  for (const status of statuses) {
    addStatusActorIds(status, actorIds)
  }

  actorIds.delete(currentActor.id)
  if (actorIds.size === 0) return new Map<string, boolean>()

  const targetActorIds = [...actorIds]
  const acceptedTargetActorIds = new Set(
    await database.getAcceptedFollowTargetActorIds({
      actorId: currentActor.id,
      targetActorIds
    })
  )

  return new Map(
    targetActorIds.map(
      (actorId) => [actorId, acceptedTargetActorIds.has(actorId)] as const
    )
  )
}

export const filterReadableStatuses = async ({
  database,
  statuses,
  currentActor
}: {
  database: Database
  statuses: Status[]
  currentActor: Actor | null
}) => {
  const readableStatuses: Status[] = []
  const statusesNeedingAccessCheck: Status[] = []

  for (const status of statuses) {
    if (isStatusPubliclyReadable(status)) {
      readableStatuses.push(status)
    } else if (currentActor) {
      statusesNeedingAccessCheck.push(status)
    }
  }

  const followerStateByActorId =
    currentActor && statusesNeedingAccessCheck.length > 0
      ? await getFollowerStateByActorId({
          database,
          statuses: statusesNeedingAccessCheck,
          currentActor
        })
      : undefined
  const checkedStatuses = (
    await Promise.all(
      statusesNeedingAccessCheck.map(async (status) =>
        (await canActorReadStatus({
          database,
          status,
          currentActor,
          followerStateByActorId
        }))
          ? status
          : null
      )
    )
  ).filter((status): status is Status => status !== null)

  const readableStatusIds = new Set(readableStatuses.map((status) => status.id))
  const checkedStatusIds = new Set(checkedStatuses.map((status) => status.id))
  return statuses.filter(
    (status) =>
      readableStatusIds.has(status.id) || checkedStatusIds.has(status.id)
  )
}
