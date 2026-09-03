import { getActorPerson } from '@/lib/activities/getActorPerson'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { mapWithConcurrency } from '@/lib/utils/mapWithConcurrency'

import { filterFederatedUrls } from './domainPolicy'

const PUBLIC_AUDIENCES = new Set([
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
])

const EXPLICIT_RECIPIENT_LOOKUP_CONCURRENCY = 8

// Delivery targets depend on the audience alone, never on the rest of the
// status. Accepting just those two fields lets a caller that no longer has the
// row resolve inboxes from a captured audience — SendDeleteNoteJob runs after
// the status has been hard-deleted. Every Status satisfies this structurally,
// so existing callers pass through unchanged.
type StatusAudience = Pick<Status, 'to' | 'cc'>

const isFollowersAudience = (actorId: string) => actorId.endsWith('/followers')

const hasFollowersAudience = (status: StatusAudience) =>
  [...status.to, ...status.cc].some(isFollowersAudience)

const hasPublicAudience = (status: StatusAudience) =>
  [...status.to, ...status.cc].some((actorId) => PUBLIC_AUDIENCES.has(actorId))

const getExplicitRecipientActorIds = (status: StatusAudience) =>
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

const getInteractedActorIds = async ({
  database,
  statusId,
  currentActor
}: {
  database: Database
  statusId: string
  currentActor: Actor
}): Promise<string[]> => {
  const actorIds: string[] = []

  try {
    const [favourites, reblogs, replies, quotingStatusIds] = await Promise.all([
      database.getFavouritedBy
        ? database.getFavouritedBy({ statusId, limit: 100 })
        : [],
      database.getRebloggedBy
        ? database.getRebloggedBy({ statusId, limit: 100 })
        : [],
      database.getStatusReplies
        ? database.getStatusReplies({ statusId, limit: 100 })
        : [],
      database.getQuotingStatusIds
        ? database.getQuotingStatusIds({
            quotedStatusId: statusId,
            state: 'accepted',
            limit: 100
          })
        : []
    ])

    for (const fav of favourites) {
      actorIds.push(fav.actorId)
    }
    for (const reb of reblogs) {
      actorIds.push(reb.actorId)
    }
    for (const rep of replies) {
      actorIds.push(rep.actorId)
    }

    if (quotingStatusIds.length > 0 && database.getStatusesByIds) {
      const quotingStatuses = await database.getStatusesByIds({
        statusIds: quotingStatusIds,
        withReplies: false
      })
      for (const quote of quotingStatuses) {
        actorIds.push(quote.actorId)
      }
    }
  } catch {
    // Interacted account discovery is best-effort
  }

  return [...new Set(actorIds)].filter((id) => id !== currentActor.id)
}

export const getFederatedStatusDeliveryInboxes = async ({
  database,
  currentActor,
  status,
  statusId
}: {
  database: Database
  currentActor: Actor
  status: StatusAudience
  statusId?: string
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

  // For public and unlisted statuses, fan updates out to third-party accounts
  // that interacted with the status (reblogged, liked, replied, or quoted),
  // matching Mastodon's StatusReachFinder.
  if (statusId && hasPublicAudience(status)) {
    const interactedActorIds = await getInteractedActorIds({
      database,
      statusId,
      currentActor
    })
    const interactedInboxes = await getRemoteActorInboxes({
      database,
      actorIds: interactedActorIds,
      currentActor
    })
    inboxes.push(
      ...interactedInboxes.filter((inbox): inbox is string => !!inbox)
    )
  }

  return filterFederatedUrls(database, [...new Set(inboxes)])
}
