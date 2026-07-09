import { normalizeHashtagSearchName } from '@/lib/database/sql/search/hashtag'
import { Database } from '@/lib/database/types'
import { TagDailyHistoryPoint } from '@/lib/types/database/operations'
import { TagHistory } from '@/lib/types/mastodon/tag'

import { TRENDS_DAYS } from './request'

const DAY_MS = 86_400_000

// Start of the current UTC day in epoch milliseconds — the newest bucket of
// the trends window.
export const getCurrentDayBucketMs = (): number =>
  Math.floor(Date.now() / DAY_MS) * DAY_MS

// Seven UTC-day buckets newest first, zero-filled for days without uses.
// `day` is the unix-second start of the UTC day; all values are strings per
// the Mastodon Tag history shape. (Moved from app/api/v1/trends/tags/route.ts
// so single-tag lookups render exactly the window trends renders.)
export const getSevenDayHistory = (
  todayBucketMs: number,
  points: TagDailyHistoryPoint[]
): TagHistory[] => {
  const pointsByDay = new Map(points.map((point) => [point.dayBucketMs, point]))
  return Array.from({ length: TRENDS_DAYS }, (_, index) => {
    const dayBucketMs = todayBucketMs - index * DAY_MS
    const point = pointsByDay.get(dayBucketMs)
    return {
      day: String(dayBucketMs / 1000),
      uses: String(point?.uses ?? 0),
      accounts: String(point?.accounts ?? 0)
    }
  })
}

// The zero-filled seven-day usage history for a single tag — the same window
// /api/v1/trends/tags computes, scoped to one name. getTagDailyHistory keys
// its result by the bare normalized name, so normalize the caller's input the
// same way before the lookup.
export const getTagHistory = async (
  database: Database,
  name: string
): Promise<TagHistory[]> => {
  const history = await database.getTagDailyHistory({
    names: [name],
    days: TRENDS_DAYS
  })
  return getSevenDayHistory(
    getCurrentDayBucketMs(),
    history.get(normalizeHashtagSearchName(name)) ?? []
  )
}
