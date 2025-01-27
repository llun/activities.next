interface BaseLikeParams {
  actorId: string
  statusId: string
}
export type CreateLikeParams = BaseLikeParams
export type DeleteLikeParams = BaseLikeParams
export type GetLikeCountParams = Pick<BaseLikeParams, 'statusId'>
export type IsActorLikedStatusParams = BaseLikeParams

export interface LikeDatabase {
  createLike(params: CreateLikeParams): Promise<void>
  deleteLike(params: DeleteLikeParams): Promise<void>
  getLikeCount(params: GetLikeCountParams): Promise<number>
  isActorLikedStatus(params: IsActorLikedStatusParams): Promise<boolean>
}
