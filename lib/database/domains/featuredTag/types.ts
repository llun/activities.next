// Parameter and result types of the featuredTag domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// A stored featured-tag row. `name` keeps the original display casing.
export type FeaturedTag = {
  id: string
  actorId: string
  name: string
  createdAt: number
}
// A featured tag with statuses_count / last_status_at derived at read time
// from the actor's own public statuses carrying the hashtag.
export type FeaturedTagWithStats = FeaturedTag & {
  statusesCount: number
  // Epoch milliseconds of the most recent matching status, or null.
  lastStatusAt: number | null
}
// The most-used hashtag among an actor's statuses, for suggestions.
export type FeaturedTagSuggestion = {
  name: string
  statusesCount: number
  lastStatusAt: number | null
}
export type GetFeaturedTagsParams = { actorId: string }
export type GetFeaturedTagByNameParams = { actorId: string; name: string }
export type CreateFeaturedTagParams = { actorId: string; name: string }
export type DeleteFeaturedTagParams = { actorId: string; id: string }
export type GetFeaturedTagSuggestionsParams = {
  actorId: string
  limit?: number
}
export type CountFeaturedTagsParams = { actorId: string }

export interface FeaturedTagDatabase {
  // The number of tags an actor features — used to enforce Mastodon's
  // per-account FeaturedTag::LIMIT before creating a new one.
  countFeaturedTags(params: CountFeaturedTagsParams): Promise<number>
  // Featured tags for an actor, ordered by statuses_count desc (Mastodon's
  // ordering), then createdAt desc as a stable tie-breaker.
  getFeaturedTags(
    params: GetFeaturedTagsParams
  ): Promise<FeaturedTagWithStats[]>
  getFeaturedTagByName(
    params: GetFeaturedTagByNameParams
  ): Promise<FeaturedTagWithStats | null>
  createFeaturedTag(
    params: CreateFeaturedTagParams
  ): Promise<FeaturedTagWithStats>
  // Owner-scoped delete; returns the removed row or null when not found/owned.
  deleteFeaturedTag(
    params: DeleteFeaturedTagParams
  ): Promise<FeaturedTag | null>
  getFeaturedTagSuggestions(
    params: GetFeaturedTagSuggestionsParams
  ): Promise<FeaturedTagSuggestion[]>
}
