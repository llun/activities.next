import { Follow } from '../activities/entities/follow'
import { Storage } from '../storage/types'

interface CreateFollowerParams {
  targetActorId: string
  actorId: string
  storage: Storage
}
export const createFollower = async ({
  targetActorId,
  actorId,
  storage
}: CreateFollowerParams) => {
  return null
}
