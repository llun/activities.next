interface BaseLikeParams {
  actorId: string
  statusId: string
}
export type CreateLikeParams = BaseLikeParams
export type DeleteLikeParams = BaseLikeParams
export type GetLikeCountParams = Pick<BaseLikeParams, 'statusId'>

export interface LikeStorage {
  createLike(params: CreateLikeParams): Promise<void>
  deleteLike(params: DeleteLikeParams): Promise<void>
  getLikeCount(params: GetLikeCountParams): Promise<number>
}
