// Parameter and result types of the actorDomainBlock domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { ActorDomainBlock } from '@/lib/types/domain/actorDomainBlock'

export type CreateActorDomainBlockParams = {
  actorId: string
  domain: string
}
export type DeleteActorDomainBlockParams = {
  actorId: string
  domain: string
}
export type IsDomainBlockedByActorParams = {
  actorId: string
  domain: string
}
export type GetActorDomainBlocksParams = {
  actorId: string
  // No limit = return every row (the timeline filter loads the viewer's full
  // set once per page request). Routes always pass an explicit limit.
  limit?: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

export interface ActorDomainBlockDatabase {
  createActorDomainBlock(
    params: CreateActorDomainBlockParams
  ): Promise<ActorDomainBlock>
  deleteActorDomainBlock(
    params: DeleteActorDomainBlockParams
  ): Promise<ActorDomainBlock | null>
  isDomainBlockedByActor(params: IsDomainBlockedByActorParams): Promise<boolean>
  getActorDomainBlocks(
    params: GetActorDomainBlocksParams
  ): Promise<ActorDomainBlock[]>
}
