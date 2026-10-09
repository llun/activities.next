// Parameter and result types of the likes (favourites) domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

interface BaseLikeParams {
  actorId: string
  statusId: string
}
export type CreateLikeParams = BaseLikeParams
export type DeleteLikeParams = BaseLikeParams
export type GetLikeCountParams = Pick<BaseLikeParams, 'statusId'>
export type IsActorLikedStatusParams = BaseLikeParams

export interface Like {
  actorId: string
  statusId: string
  createdAt: number
}

export type GetLikesParams = {
  actorId: string
  limit: number
  // Opaque composite cursors produced by encodeFavouriteCursor; older = max_id,
  // newer = min_id/since_id. Invalid cursors yield an empty page.
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

export interface LikeDatabase {
  // Resolves true only when a new like row was inserted (false for an existing
  // like or an unknown status), so callers notify once per real like.
  createLike(params: CreateLikeParams): Promise<boolean>
  deleteLike(params: DeleteLikeParams): Promise<void>
  getLikeCount(params: GetLikeCountParams): Promise<number>
  isActorLikedStatus(params: IsActorLikedStatusParams): Promise<boolean>
  getLikes(params: GetLikesParams): Promise<Like[]>
}
