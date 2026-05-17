import { getActorPerson } from '@/lib/activities/getActorPerson'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

import { filterFederatedUrls } from './domainPolicy'

const PUBLIC_AUDIENCES = new Set([
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
])

const isFollowersAudience = (actorId: string) => actorId.endsWith('/followers')

const hasFollowersAudience = (status: Status) =>
  [...status.to, ...status.cc].some(isFollowersAudience)

const hasPublicAudience = (status: Status) =>
  [...status.to, ...status.cc].some((actorId) => PUBLIC_AUDIENCES.has(actorId))

const getExplicitRecipientActorIds = (status: Status) =>
  [...new Set([...status.to, ...status.cc])].filter(
    (actorId) => !PUBLIC_AUDIENCES.has(actorId) && !isFollowersAudience(actorId)
  )

const isSameOriginActorId = (actorId: string, currentActor: Actor) => {
  try {
    return new URL(actorId).origin === new URL(currentActor.id).origin
  } catch {
    return false
  }
}

const getRemoteActorInbox = async ({
  database,
  actorId,
  currentActor
}: {
  database: Database
  actorId: string
  currentActor: Actor
}) => {
  const actor = await database.getActorFromId({ id: actorId })
  if (actor) {
    if (actor.privateKey) return null
    return actor.sharedInboxUrl || actor.inboxUrl
  }

  if (isSameOriginActorId(actorId, currentActor)) return null

  const person = await getActorPerson({ actorId })
  return person ? person.endpoints?.sharedInbox || person.inbox : null
}

export const getFederatedStatusDeliveryInboxes = async ({
  database,
  currentActor,
  status
}: {
  database: Database
  currentActor: Actor
  status: Status
}) => {
  const inboxes: string[] = []

  if (hasPublicAudience(status) || hasFollowersAudience(status)) {
    inboxes.push(
      ...(await database.getFollowersInbox({
        targetActorId: currentActor.id
      }))
    )
  }

  const recipientInboxes = await Promise.all(
    getExplicitRecipientActorIds(status)
      .filter((actorId) => actorId !== currentActor.id)
      .map((actorId) =>
        getRemoteActorInbox({
          database,
          actorId,
          currentActor
        })
      )
  )
  inboxes.push(...recipientInboxes.filter((inbox): inbox is string => !!inbox))

  return filterFederatedUrls(database, [...new Set(inboxes)])
}
