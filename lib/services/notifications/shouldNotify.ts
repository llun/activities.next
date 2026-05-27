import { Database } from '@/lib/database/types'

export const shouldCreateNotification = async (
  database: Database,
  recipientActorId: string,
  sourceActorId: string
) => {
  if (recipientActorId === sourceActorId) return false
  if (
    await database.isEitherBlocking({
      actorIdA: recipientActorId,
      actorIdB: sourceActorId
    })
  ) {
    return false
  }
  const mute = await database.getMute({
    actorId: recipientActorId,
    targetActorId: sourceActorId
  })
  return !(mute && mute.notifications)
}
