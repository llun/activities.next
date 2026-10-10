// Parameter and result types of the trends domain.
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.

// A locally-trending hashtag computed live from the public statuses created
// within the requested day window. `uses` counts distinct statuses carrying
// the tag; `accounts` counts distinct status authors. `name` is the bare
// (no leading `#`) normalized tag name.
export type TrendingTag = {
  name: string
  uses: number
  accounts: number
}

// One UTC-day usage bucket for a tag. `dayBucketMs` is the epoch-millisecond
// start of the UTC day (Math.floor(createdAtMs / DAY_MS) * DAY_MS).
export type TagDailyHistoryPoint = {
  dayBucketMs: number
  uses: number
  accounts: number
}

export type GetTrendingTagsParams = {
  days: number
  limit: number
  offset: number
}
export type GetTagDailyHistoryParams = {
  // Bare (no leading `#`) normalized hashtag names.
  names: string[]
  days: number
}
export type GetTrendingStatusCandidateIdsParams = {
  days: number
}

export interface TrendsDatabase {
  // Hashtags on public Note/Poll statuses created within the last `days`
  // days, ranked by distinct status uses descending (tag name ascending as
  // the deterministic tiebreaker), sliced by offset/limit.
  getTrendingTags(params: GetTrendingTagsParams): Promise<TrendingTag[]>
  // Trending-status candidate ids: public, top-level (non-reply) Note/Poll
  // statuses authored by a local actor within the last `days` days, newest
  // first, capped at a safety bound. Unlike a small fixed newest-N timeline
  // slice this keeps the whole realistic windowed set so a highly-interacted
  // older-within-window status is not dropped before the service ranks it; the
  // cap only guards memory and the bind-variable limit against a pathological
  // backlog on a busy instance.
  getTrendingStatusCandidateIds(
    params: GetTrendingStatusCandidateIdsParams
  ): Promise<string[]>
  // Per-UTC-day usage buckets (newest first) for each requested name within
  // the last `days` days. Every requested name maps to an entry — possibly an
  // empty list — so routes can zero-fill missing days uniformly.
  getTagDailyHistory(
    params: GetTagDailyHistoryParams
  ): Promise<Map<string, TagDailyHistoryPoint[]>>
}
