import { Database } from '@/lib/database/types'
import { Block as BlockActivity } from '@/lib/types/activitypub'
import { normalizeActorId } from '@/lib/utils/activitypub'

const getObjectId = (object: BlockActivity['object']) =>
  typeof object === 'string' ? object : object.id

const actorIdsMatch = (firstActorId: string, secondActorId: string) => {
  const normalizedFirstActorId = normalizeActorId(firstActorId)
  const normalizedSecondActorId = normalizeActorId(secondActorId)

  return (
    Boolean(normalizedFirstActorId) &&
    normalizedFirstActorId === normalizedSecondActorId
  )
}

const uniqueActorPairs = (
  pairs: { actorId: string; targetActorId: string }[]
) => {
  const seen = new Set<string>()

  return pairs.filter((pair) => {
    const key = `${pair.actorId}\0${pair.targetActorId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const deleteBlockByActorPairs = async ({
  database,
  pairs
}: {
  database: Database
  pairs: { actorId: string; targetActorId: string }[]
}) => {
  for (const pair of uniqueActorPairs(pairs)) {
    const block = await database.deleteBlock(pair)
    if (block) return block
  }

  return null
}

interface ApplyRemoteUnblockParams {
  database: Database
  actorId: string
  object: BlockActivity | string
  targetActorId: string
}

export const applyRemoteUnblock = async ({
  database,
  actorId,
  object,
  targetActorId
}: ApplyRemoteUnblockParams) => {
  const normalizedActorId = normalizeActorId(actorId)
  const normalizedTargetActorId = normalizeActorId(targetActorId)
  if (!normalizedActorId || !normalizedTargetActorId) return null

  if (typeof object === 'string') {
    const block = await database.getBlockByUri({ uri: object })
    if (
      !block ||
      !actorIdsMatch(block.actorId, normalizedActorId) ||
      !actorIdsMatch(block.targetActorId, normalizedTargetActorId)
    )
      return null

    return database.deleteBlockByUri({
      actorId: block.actorId,
      uri: object
    })
  }

  if (
    !actorIdsMatch(object.actor, normalizedActorId) ||
    !actorIdsMatch(getObjectId(object.object), normalizedTargetActorId)
  ) {
    return null
  }

  const block = await database.getBlockByUri({ uri: object.id })
  if (block) {
    if (
      !actorIdsMatch(block.actorId, normalizedActorId) ||
      !actorIdsMatch(block.targetActorId, normalizedTargetActorId)
    ) {
      return null
    }
    return database.deleteBlockByUri({
      actorId: block.actorId,
      uri: object.id
    })
  }

  return deleteBlockByActorPairs({
    database,
    pairs: [
      {
        actorId: object.actor,
        targetActorId: getObjectId(object.object)
      },
      {
        actorId,
        targetActorId
      },
      {
        actorId: normalizedActorId,
        targetActorId: normalizedTargetActorId
      }
    ]
  })
}
