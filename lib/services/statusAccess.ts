import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { FollowStatus } from '@/lib/types/domain/follow'
import { Status, StatusType } from '@/lib/types/domain/status'
import { getVisibility } from '@/lib/utils/getVisibility'

const isPublicOrUnlisted = (status: Status): boolean => {
  const visibility = getVisibility(status.to, status.cc)
  return visibility === 'public' || visibility === 'unlisted'
}

const hasFollowersAudience = (status: Status): boolean =>
  [...status.to, ...status.cc].some((item) => item.endsWith('/followers'))

const isDirectRecipient = (status: Status, actor: Actor): boolean =>
  status.to.includes(actor.id) || status.cc.includes(actor.id)

export const isStatusPubliclyReadable = (status: Status): boolean => {
  if (!isPublicOrUnlisted(status)) return false

  if (status.type === StatusType.enum.Announce) {
    return isStatusPubliclyReadable(status.originalStatus)
  }

  return true
}

const canActorReadSingleStatus = async ({
  database,
  status,
  currentActor
}: {
  database: Database
  status: Status
  currentActor: Actor
}): Promise<boolean> => {
  if (isPublicOrUnlisted(status)) return true
  if (currentActor.id === status.actorId) return true

  if (hasFollowersAudience(status)) {
    const follow = await database.getAcceptedOrRequestedFollow({
      actorId: currentActor.id,
      targetActorId: status.actorId
    })
    return follow?.status === FollowStatus.enum.Accepted
  }

  return isDirectRecipient(status, currentActor)
}

export const canActorReadStatus = async ({
  database,
  status,
  currentActor
}: {
  database: Database
  status: Status
  currentActor: Actor | null
}): Promise<boolean> => {
  if (isStatusPubliclyReadable(status)) return true
  if (!currentActor) return false

  if (status.type === StatusType.enum.Announce) {
    const canReadAnnounce = await canActorReadSingleStatus({
      database,
      status,
      currentActor
    })

    if (!canReadAnnounce) return false

    return canActorReadStatus({
      database,
      status: status.originalStatus,
      currentActor
    })
  }

  return canActorReadSingleStatus({ database, status, currentActor })
}
