import { Database } from '@/lib/database/types'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'

const CANDIDATE_WINDOW_DAYS = 7

interface GetTrendingStatusesParams {
  database: Database
  limit: number
  offset: number
}

/**
 * Local trending statuses computed live from the last seven days of public
 * interactions on this instance. Candidates are the windowed set of top-level
 * public statuses by local actors (`getTrendingStatusCandidateIds` resolves
 * the public/window/type filters in SQL and applies a safety cap), not a small
 * fixed newest-N timeline slice — so a highly-interacted older-within-window
 * status is not dropped before ranking. Ranking stays app-side: the per-status
 * counters are key-value rows, so joining on their concatenated keys in SQL
 * would be dialect-fragile.
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
  const candidateIds = await database.getTrendingStatusCandidateIds({
    days: CANDIDATE_WINDOW_DAYS
  })
  if (candidateIds.length === 0) return []

  const candidates = await database.getStatusesByIds({
    statusIds: candidateIds
  })
  // The SQL filter already restricts candidates to Note/Poll; this narrows the
  // type for the counter lookups below (an Announce carries no own counters).
  const windowedStatuses = candidates.filter(
    (status): status is StatusNote | StatusPoll =>
      status.type === StatusType.enum.Note ||
      status.type === StatusType.enum.Poll
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
