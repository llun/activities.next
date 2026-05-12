import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'

import { canActorReadStatus } from './statusAccess'

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
}) =>
  (
    await Promise.all(
      statuses.map(async (status) =>
        (await canActorReadStatus({ database, status, currentActor }))
          ? status
          : null
      )
    )
  ).filter((status): status is Status => status !== null)
