import { Database } from '@/lib/database/types'
import { Block as BlockActivity } from '@/lib/types/activitypub'

const getObjectId = (object: BlockActivity['object']) =>
  typeof object === 'string' ? object : object.id

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
  if (typeof object === 'string') {
    const block = await database.getBlockByUri({ uri: object })
    if (
      !block ||
      block.actorId !== actorId ||
      block.targetActorId !== targetActorId
    )
      return null

    return database.deleteBlockByUri({
      actorId,
      uri: object
    })
  }

  if (object.actor !== actorId || getObjectId(object.object) !== targetActorId)
    return null

  const block = await database.getBlockByUri({ uri: object.id })
  if (block) {
    if (block.actorId !== actorId || block.targetActorId !== targetActorId) {
      return null
    }
    return database.deleteBlockByUri({
      actorId,
      uri: object.id
    })
  }

  return database.deleteBlock({
    actorId,
    targetActorId
  })
}
