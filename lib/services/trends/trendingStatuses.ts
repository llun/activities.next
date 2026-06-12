import { Database } from '@/lib/database/types'
import { Timeline } from '@/lib/services/timelines/types'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'

const CANDIDATE_WINDOW_DAYS = 7
const CANDIDATE_LIMIT = 200
const DAY_MS = 86_400_000

interface GetTrendingStatusesParams {
  database: Database
  limit: number
  offset: number
}

/**
 * Local trending statuses computed live from the last seven days of public
 * interactions on this instance. Candidates come from the local-public
 * timeline (top-level public statuses by local actors, newest first) and are
 * ranked app-side: the per-status counters are key-value rows, so joining on
 * their concatenated keys in SQL would be dialect-fragile.
 *
 * The score reads exactly the fields the Mastodon serializer exposes —
 * `status.totalLikes` (favourites_count) plus the reblog and reply counters
 * (reblogs_count / replies_count) — so the ranking always matches the counts
 * clients see. Boosts are skipped: an Announce is not trending content itself
 * and carries no own counters; the boosted original ranks through its own row.
 */
export const getTrendingStatuses = async ({
  database,
  limit,
  offset
}: GetTrendingStatusesParams): Promise<Status[]> => {
  const candidates = await database.getTimeline({
    timeline: Timeline.LOCAL_PUBLIC,
    limit: CANDIDATE_LIMIT
  })

  const since = Date.now() - CANDIDATE_WINDOW_DAYS * DAY_MS
  const windowedStatuses = candidates.filter(
    (status): status is StatusNote | StatusPoll =>
      status.type !== StatusType.enum.Announce && status.createdAt >= since
  )
  if (windowedStatuses.length === 0) return []

  const statusIds = windowedStatuses.map((status) => status.id)
  const [reblogCounts, replyCounts] = await Promise.all([
    database.getStatusReblogsCounts({ statusIds }),
    database.getStatusRepliesCounts({ statusIds })
  ])

  return windowedStatuses
    .map((status) => ({
      status,
      score:
        (status.totalLikes || 0) +
        2 * (reblogCounts[status.id] ?? 0) +
        (replyCounts[status.id] ?? 0)
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (first, second) =>
        second.score - first.score ||
        second.status.createdAt - first.status.createdAt
    )
    .slice(offset, offset + limit)
    .map(({ status }) => status)
}
