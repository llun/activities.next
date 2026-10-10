// Parameter and result types of the block domain (actor-to-actor blocks).
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type { Block } from '@/lib/types/domain/block'

export type CreateBlockParams = {
  actorId: string
  targetActorId: string
  uri: string
}
export type DeleteBlockParams = {
  actorId: string
  targetActorId: string
}
export type DeleteBlockByUriParams = {
  actorId: string
  uri: string
}
export type GetBlockParams = {
  actorId: string
  targetActorId: string
}
export type GetBlockByUriParams = {
  uri: string
}
export type IsBlockingParams = {
  actorId: string
  targetActorId: string
}
export type IsEitherBlockingParams = {
  actorIdA: string
  actorIdB: string
}
export type GetBlocksParams = {
  actorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type GetBlockRelationsParams = {
  actorIds: string[]
  targetActorIds: string[]
}
export type BlockRelation = Pick<Block, 'actorId' | 'targetActorId'>

export interface BlockDatabase {
  createBlock(params: CreateBlockParams): Promise<Block>
  deleteBlock(params: DeleteBlockParams): Promise<Block | null>
  deleteBlockByUri(params: DeleteBlockByUriParams): Promise<Block | null>
  getBlock(params: GetBlockParams): Promise<Block | null>
  getBlockByUri(params: GetBlockByUriParams): Promise<Block | null>
  isBlocking(params: IsBlockingParams): Promise<boolean>
  isEitherBlocking(params: IsEitherBlockingParams): Promise<boolean>
  getBlocks(params: GetBlocksParams): Promise<Block[]>
  getBlockRelations(params: GetBlockRelationsParams): Promise<BlockRelation[]>
}
