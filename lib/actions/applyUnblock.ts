import { Database } from '@/lib/database/types'

interface ApplyUnblockParams {
  database: Database
  actorId: string
  targetActorId: string
}

export const applyUnblock = ({
  database,
  actorId,
  targetActorId
}: ApplyUnblockParams) =>
  database.deleteBlock({
    actorId,
    targetActorId
  })
