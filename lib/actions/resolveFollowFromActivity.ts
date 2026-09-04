import { Database } from '@/lib/database/types'
import { FollowOrObjectRef } from '@/lib/types/activitypub/activities'
import { Follow } from '@/lib/types/domain/follow'
import { actorIdsMatch } from '@/lib/utils/activitypub'

interface ResolveFollowFromActivityParams {
  activity: {
    actor: string
    object: FollowOrObjectRef
  }
  database: Database
  recipientActorId?: string
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UUID_GLOBAL_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

export const extractFollowIdCandidates = (uri: string): string[] => {
  const candidates: string[] = []

  const uuidMatches = uri.match(UUID_GLOBAL_REGEX)
  if (uuidMatches) {
    candidates.push(...uuidMatches)
  }

  const followsMatch = uri.match(/follows\/([0-9a-fA-F-]+)/)
  if (followsMatch && UUID_REGEX.test(followsMatch[1])) {
    candidates.push(followsMatch[1])
  }

  try {
    const url = new URL(uri)
    if (url.hash) {
      const hashSegments = url.hash.replace(/^#/, '').split('/').filter(Boolean)
      for (const segment of hashSegments) {
        if (UUID_REGEX.test(segment)) {
          candidates.push(segment)
        }
      }
      if (hashSegments.length > 0) {
        candidates.push(hashSegments[hashSegments.length - 1])
      }
    }
    const pathSegments = url.pathname.split('/').filter(Boolean)
    for (const segment of pathSegments) {
      if (UUID_REGEX.test(segment)) {
        candidates.push(segment)
      }
    }
    if (pathSegments.length > 0) {
      candidates.push(pathSegments[pathSegments.length - 1])
    }
  } catch {
    const segments = uri.split(/[/,#]/).filter(Boolean)
    for (const segment of segments) {
      if (UUID_REGEX.test(segment)) {
        candidates.push(segment)
      }
    }
    if (segments.length > 0) {
      candidates.push(segments[segments.length - 1])
    }
  }
  return [...new Set(candidates)]
    .filter((id) => UUID_REGEX.test(id))
    .slice(0, 8)
}

export const extractFollowIdFromUri = (uri: string): string | null => {
  const candidates = extractFollowIdCandidates(uri)
  return candidates.length > 0 ? candidates[0] : null
}

export const resolveFollowFromActivity = async ({
  activity,
  database,
  recipientActorId
}: ResolveFollowFromActivityParams): Promise<Follow | null> => {
  const objectUri =
    typeof activity.object === 'string'
      ? activity.object
      : typeof activity.object === 'object' &&
          activity.object !== null &&
          'id' in activity.object &&
          typeof activity.object.id === 'string'
        ? activity.object.id
        : null

  if (objectUri) {
    const candidateIds = extractFollowIdCandidates(objectUri)
    for (const candidateId of candidateIds) {
      const follow = await database.getFollowFromId({ followId: candidateId })
      if (follow) {
        const matchesTarget = actorIdsMatch(
          follow.targetActorId,
          activity.actor
        )
        const matchesRecipient =
          !recipientActorId || actorIdsMatch(follow.actorId, recipientActorId)

        if (matchesTarget && matchesRecipient) {
          return follow
        }
      }
    }
  }

  // If activity.object is an embedded Follow object with actor and object:
  if (
    typeof activity.object === 'object' &&
    activity.object !== null &&
    'actor' in activity.object &&
    typeof activity.object.actor === 'string' &&
    'object' in activity.object &&
    typeof activity.object.object === 'string'
  ) {
    const actorId = activity.object.actor
    const targetActorId = activity.object.object
    const targetMatchesSender = actorIdsMatch(targetActorId, activity.actor)
    const matchesRecipient =
      !recipientActorId || actorIdsMatch(actorId, recipientActorId)

    if (targetMatchesSender && matchesRecipient) {
      const strippedActorId = actorId.replace(/\/+$/, '')
      const strippedTargetActorId = targetActorId.replace(/\/+$/, '')
      const follow =
        (await database.getAcceptedOrRequestedFollow({
          actorId,
          targetActorId
        })) ??
        (await database.getAcceptedOrRequestedFollow({
          actorId: strippedActorId,
          targetActorId: strippedTargetActorId
        })) ??
        (await database.getAcceptedOrRequestedFollow({
          actorId: `${strippedActorId}/`,
          targetActorId: `${strippedTargetActorId}/`
        }))
      if (follow) return follow
    }
  }

  // Fallback: If recipientActorId (the local actor who sent the follow) is known,
  // query by (recipientActorId, activity.actor)
  if (recipientActorId) {
    const strippedRecipient = recipientActorId.replace(/\/+$/, '')
    const strippedSender = activity.actor.replace(/\/+$/, '')
    const follow =
      (await database.getAcceptedOrRequestedFollow({
        actorId: recipientActorId,
        targetActorId: activity.actor
      })) ??
      (await database.getAcceptedOrRequestedFollow({
        actorId: strippedRecipient,
        targetActorId: strippedSender
      })) ??
      (await database.getAcceptedOrRequestedFollow({
        actorId: `${strippedRecipient}/`,
        targetActorId: `${strippedSender}/`
      }))
    if (follow) return follow
  }

  return null
}
