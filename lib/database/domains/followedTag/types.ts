// Parameter and result types of the followedTag domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

export type FollowedTag = {
  id: string
  actorId: string
  name: string
  createdAt: number
}
export type FollowTagParams = { actorId: string; name: string }
export type UnfollowTagParams = { actorId: string; name: string }
export type GetFollowedTagsParams = {
  actorId: string
  limit?: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type IsFollowingTagParams = { actorId: string; name: string }

export interface FollowedTagDatabase {
  followTag(params: FollowTagParams): Promise<FollowedTag>
  unfollowTag(params: UnfollowTagParams): Promise<FollowedTag | null>
  getFollowedTags(params: GetFollowedTagsParams): Promise<FollowedTag[]>
  isFollowingTag(params: IsFollowingTagParams): Promise<boolean>
}
