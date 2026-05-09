import type { Database } from '@/lib/database/types'
import type { ActorProfile } from '@/lib/types/domain/actor'

export const getFollowListBlockedActorIds = async (
  database: Pick<Database, 'getBlockRelations'>,
  currentActorId: string | undefined,
  users: ActorProfile[]
) => {
  if (!currentActorId || users.length === 0) return []

  const userIds = [...new Set(users.map((user) => user.id))]
  const userIdSet = new Set(userIds)
  const relations = await database.getBlockRelations({
    actorIds: [currentActorId],
    targetActorIds: userIds
  })
  const blockedActorIds = new Set(
    relations.flatMap((relation) => {
      if (
        relation.actorId === currentActorId &&
        userIdSet.has(relation.targetActorId)
      ) {
        return [relation.targetActorId]
      }
      if (
        relation.targetActorId === currentActorId &&
        userIdSet.has(relation.actorId)
      ) {
        return [relation.actorId]
      }
      return []
    })
  )

  return users
    .map((user) => user.id)
    .filter((userId) => blockedActorIds.has(userId))
}
