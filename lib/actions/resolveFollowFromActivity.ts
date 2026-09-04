import { Database } from '@/lib/database/types'
import { FollowOrObjectRef } from '@/lib/types/activitypub/activities'
import { Follow } from '@/lib/types/domain/follow'
import { normalizeActorId } from '@/lib/utils/activitypub'

interface ResolveFollowFromActivityParams {
  activity: {
    actor: string
    object: FollowOrObjectRef
  }
  database: Database
  recipientActorId?: string
}

export const extractFollowIdCandidates = (uri: string): string[] => {
  const candidates: string[] = []
  try {
    const url = new URL(uri)
    if (url.hash) {
      const hashSegments = url.hash.replace(/^#/, '').split('/').filter(Boolean)
      if (hashSegments.length > 0) {
        candidates.push(hashSegments[hashSegments.length - 1])
      }
    }
    const pathSegments = url.pathname.split('/').filter(Boolean)
    if (pathSegments.length > 0) {
      candidates.push(pathSegments[pathSegments.length - 1])
    }
  } catch {
    const segments = uri.split(/[/,#]/).filter(Boolean)
    if (segments.length > 0) {
      candidates.push(segments[segments.length - 1])
    }
  }
  return [...new Set(candidates)]
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
        const matchesTarget =
          !activity.actor ||
          follow.targetActorId === activity.actor ||
          follow.targetActorId.replace(/\/+$/, '') ===
            activity.actor.replace(/\/+$/, '')
        const matchesRecipient =
          !recipientActorId ||
          follow.actorId === recipientActorId ||
          follow.actorId.replace(/\/+$/, '') ===
            recipientActorId.replace(/\/+$/, '')

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
    const targetMatchesSender =
      !activity.actor ||
      targetActorId === activity.actor ||
      targetActorId.replace(/\/+$/, '') === activity.actor.replace(/\/+$/, '')

    if (targetMatchesSender) {
      const follow =
        (await database.getAcceptedOrRequestedFollow({
          actorId,
          targetActorId
        })) ??
        (await database.getAcceptedOrRequestedFollow({
          actorId: actorId.replace(/\/+$/, ''),
          targetActorId: targetActorId.replace(/\/+$/, '')
        }))
      if (follow) return follow
    }
  }

  // Fallback: If recipientActorId (the local actor who sent the follow) is known,
  // query by (recipientActorId, activity.actor)
  if (recipientActorId) {
    const normalizedRecipient =
      normalizeActorId(recipientActorId) ?? recipientActorId
    const normalizedSender = normalizeActorId(activity.actor) ?? activity.actor
    const follow =
      (await database.getAcceptedOrRequestedFollow({
        actorId: recipientActorId,
        targetActorId: activity.actor
      })) ??
      (await database.getAcceptedOrRequestedFollow({
        actorId: normalizedRecipient,
        targetActorId: normalizedSender
      }))
    if (follow) return follow
  }

  return null
}
