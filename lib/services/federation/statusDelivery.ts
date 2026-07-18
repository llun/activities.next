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

const EXPLICIT_RECIPIENT_LOOKUP_CONCURRENCY = 8

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

const mapWithConcurrency = async <T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>
): Promise<TResult[]> => {
  const results: TResult[] = []

  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency)
    results.push(...(await Promise.all(chunk.map(mapper))))
  }

  return results
}

const getRemoteActorInboxForMissingActor = async ({
  actorId,
  currentActor
}: {
  actorId: string
  currentActor: Actor
}) => {
  if (isSameOriginActorId(actorId, currentActor)) return null

  const person = await getActorPerson({ actorId })
  return person ? person.endpoints?.sharedInbox || person.inbox : null
}

const getRemoteActorInboxes = async ({
  database,
  actorIds,
  currentActor
}: {
  database: Database
  actorIds: string[]
  currentActor: Actor
}) => {
  if (actorIds.length === 0) return []

  const actors = await database.getActorsFromIds({ ids: actorIds })
  const actorById = new Map(actors.map((actor) => [actor.id, actor]))
  const cachedInboxes = actors
    .filter((actor) => !actor.privateKey)
    .map((actor) => actor.sharedInboxUrl || actor.inboxUrl)
  const missingActorIds = actorIds.filter((actorId) => !actorById.has(actorId))
  const fetchedInboxes = await mapWithConcurrency(
    missingActorIds,
    EXPLICIT_RECIPIENT_LOOKUP_CONCURRENCY,
    (actorId) =>
      getRemoteActorInboxForMissingActor({
        actorId,
        currentActor
      })
  )

  return [...cachedInboxes, ...fetchedInboxes]
}

// The remote inboxes of a status's explicitly-named (to/cc) recipients only —
// no follower or relay expansion. Used to fan a stamp revocation out to the
// quoting note's named third-party recipients (FEP-044f), where the follower/
// relay branches of getFederatedStatusDeliveryInboxes would incorrectly key off
// the signer (the quoted author) rather than the quoting note's audience. Local
// recipients and the signer itself are excluded, and the result is domain-policy
// filtered.
export const getExplicitRecipientInboxes = async ({
  database,
  currentActor,
  status
}: {
  database: Database
  currentActor: Actor
  status: Status
}) => {
  const explicitRecipientActorIds = getExplicitRecipientActorIds(status).filter(
    (actorId) => actorId !== currentActor.id
  )
  const recipientInboxes = await getRemoteActorInboxes({
    database,
    actorIds: explicitRecipientActorIds,
    currentActor
  })
  return filterFederatedUrls(database, [
    ...new Set(recipientInboxes.filter((inbox): inbox is string => !!inbox))
  ])
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

  // Public posts are also forwarded to every accepted relay's inbox so the
  // relay can redistribute them. Relays only carry public activities, so this
  // is gated on a public audience. The Set dedup + domain-policy filter below
  // cover relay inboxes too.
  if (hasPublicAudience(status)) {
    const relays = await database.getAcceptedRelays()
    inboxes.push(...relays.map((relay) => relay.inboxUrl))
  }

  const explicitRecipientActorIds = getExplicitRecipientActorIds(status).filter(
    (actorId) => actorId !== currentActor.id
  )
  const recipientInboxes = await getRemoteActorInboxes({
    database,
    actorIds: explicitRecipientActorIds,
    currentActor
  })
  inboxes.push(...recipientInboxes.filter((inbox): inbox is string => !!inbox))

  return filterFederatedUrls(database, [...new Set(inboxes)])
}
