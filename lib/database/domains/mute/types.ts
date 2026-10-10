// Parameter and result types of the (actor) mute domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { Mute } from '@/lib/types/domain/mute'

export type CreateMuteParams = {
  actorId: string
  targetActorId: string
  notifications: boolean
  endsAt: number | null
}
export type DeleteMuteParams = {
  actorId: string
  targetActorId: string
}
export type GetMuteParams = {
  actorId: string
  targetActorId: string
}
export type GetMuteRelationsParams = {
  actorIds: string[]
  targetActorIds: string[]
}
export type MuteRelation = Pick<
  Mute,
  'actorId' | 'targetActorId' | 'notifications'
>
export type GetMutesParams = {
  actorId: string
  limit?: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

export interface MuteDatabase {
  createMute(params: CreateMuteParams): Promise<Mute>
  deleteMute(params: DeleteMuteParams): Promise<Mute | null>
  getMute(params: GetMuteParams): Promise<Mute | null>
  getMuteRelations(params: GetMuteRelationsParams): Promise<MuteRelation[]>
  getMutes(params: GetMutesParams): Promise<Mute[]>
}
