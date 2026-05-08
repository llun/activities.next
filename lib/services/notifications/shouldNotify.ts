import { Database } from '@/lib/database/types'

export const shouldCreateNotification = async (
  database: Database,
  recipientActorId: string,
  sourceActorId: string
) => {
  if (recipientActorId === sourceActorId) return false
  return !(await database.isEitherBlocking({
    actorIdA: recipientActorId,
    actorIdB: sourceActorId
  }))
}
