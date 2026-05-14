import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'

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

  const checkedStatuses = (
    await Promise.all(
      statusesNeedingAccessCheck.map(async (status) =>
        (await canActorReadStatus({ database, status, currentActor }))
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
