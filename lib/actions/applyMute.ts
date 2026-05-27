import { Database } from '@/lib/database/types'

interface ApplyMuteParams {
  database: Database
  actorId: string
  targetActorId: string
  notifications: boolean
  endsAt: number | null
}

export const applyMute = ({
  database,
  actorId,
  targetActorId,
  notifications,
  endsAt
}: ApplyMuteParams) =>
  database.createMute({
    actorId,
    targetActorId,
    notifications,
    endsAt
  })
