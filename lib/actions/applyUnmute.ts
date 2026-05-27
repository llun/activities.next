import { Database } from '@/lib/database/types'

interface ApplyUnmuteParams {
  database: Database
  actorId: string
  targetActorId: string
}

export const applyUnmute = ({
  database,
  actorId,
  targetActorId
}: ApplyUnmuteParams) =>
  database.deleteMute({
    actorId,
    targetActorId
  })
