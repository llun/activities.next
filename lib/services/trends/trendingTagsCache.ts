import { Database } from '@/lib/database/types'
import {
  TagDailyHistoryPoint,
  TrendingTag
} from '@/lib/types/database/operations'

// Trending tags are an instance-wide aggregate over a 7-day window of every
// public hashtag row, and the endpoint serves anonymous callers, so each hit
// used to cost a full-window aggregation. A minute of staleness is invisible
// on a trends list, and it turns a request flood into one query per page.
export const TRENDING_TAGS_CACHE_TTL_MS = 60_000
// `offset` is caller-controlled, so the number of distinct keys is too: bound
// the cache so varying it cannot grow memory without limit.
const MAX_CACHE_ENTRIES = 64

export type TrendingTagsSnapshot = {
  trendingTags: TrendingTag[]
  history: Map<string, TagDailyHistoryPoint[]>
}

type CacheEntry = {
  expiresAt: number
  snapshot: Promise<TrendingTagsSnapshot>
}

// One process serves one database; if a different one shows up (tests) its
// snapshots must not be served from the previous one's cache.
let cacheOwner: Database | null = null
let cache = new Map<string, CacheEntry>()

export const resetTrendingTagsCacheForTests = () => {
  cacheOwner = null
  cache = new Map()
}

const evict = (now: number) => {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/**
 * Viewer-independent part of GET /api/v1/trends/tags (the ranking and its
 * daily history), cached per (days, limit, offset) for a short TTL. Concurrent
 * identical requests share one in-flight query. A failed load is not cached.
 */
export const getCachedTrendingTags = (
  database: Database,
  params: { days: number; limit: number; offset: number },
  now: number = Date.now()
): Promise<TrendingTagsSnapshot> => {
  if (cacheOwner !== database) resetTrendingTagsCacheForTests()
  cacheOwner = database
  const entries = cache

  const key = `${params.days}:${params.limit}:${params.offset}`
  const hit = entries.get(key)
  if (hit && hit.expiresAt > now) return hit.snapshot

  evict(now)
  const snapshot = (async (): Promise<TrendingTagsSnapshot> => {
    const trendingTags = await database.getTrendingTags(params)
    const history = await database.getTagDailyHistory({
      names: trendingTags.map((trendingTag) => trendingTag.name),
      days: params.days
    })
    return { trendingTags, history }
  })()
  const entry: CacheEntry = {
    expiresAt: now + TRENDING_TAGS_CACHE_TTL_MS,
    snapshot
  }
  entries.set(key, entry)
  snapshot.catch(() => {
    if (entries.get(key) === entry) entries.delete(key)
  })
  return snapshot
}
