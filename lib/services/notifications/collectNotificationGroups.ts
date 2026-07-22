import { Database } from '@/lib/database/types'
import { prepareGroupedNotifications } from '@/lib/services/notifications/getNotificationGroupsEnvelope'
import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import {
  GetNotificationsParams,
  Notification,
  NotificationType
} from '@/lib/types/database/operations'
import { urlToId } from '@/lib/utils/urlToId'

// Per-fetch batch size and the hard cap on raw rows scanned. The cap bounds the
// number of DB round-trips so a pathological burst can't make a request scan the
// whole table; once it's hit we return whatever groups we have.
const DEFAULT_MAX_ITERATIONS = 5

interface CollectParams {
  database: Database
  // Base query fields shared across batches (actorId, types, excludeTypes,
  // onlyUnread, includeFiltered, minNotificationId/sinceNotificationId).
  baseQuery: Omit<
    GetNotificationsParams,
    'limit' | 'maxNotificationId' | 'offset'
  >
  // Desired number of distinct groups.
  limit: number
  // Rows fetched per DB call.
  batchSize: number
  // Optional source-actor filter (Mastodon account_id), applied per batch.
  accountId?: string
  // Types eligible for grouping (others stay individual).
  groupedTypes?: Set<NotificationType>
  // Cursor to start scanning from (max_id); rows older than this are fetched.
  startCursor?: string
  // Overrides the default iteration cap (mainly for tests).
  maxIterations?: number
}

interface CollectResult {
  // Accumulated raw rows (after account filtering), most-recent-first.
  rawNotifications: Notification[]
  // Grouped result over the accumulated rows (may exceed limit).
  groups: GroupedNotification[]
  // True when the DB ran out of matching rows (no further pages exist).
  exhausted: boolean
  // The id of the last raw row scanned (the next-page cursor), regardless of
  // account filtering — set even when every scanned row was filtered out, so the
  // caller can keep paging toward matching rows further down the timeline.
  lastScannedId?: string
}

/**
 * Iteratively fetches and groups notifications until at least `limit` distinct
 * groups are available or the source is exhausted (or the iteration cap is hit).
 *
 * Fixes the bursty-group problem: a single status with thousands of likes no
 * longer fills an entire page with one group while hiding the other groups that
 * exist just past a fixed over-fetch window. The cursor advances by the raw row
 * tail (not the account-filtered tail) so account_id paging also makes progress.
 */
export const collectNotificationGroups = async ({
  database,
  baseQuery,
  limit,
  batchSize,
  accountId,
  groupedTypes,
  startCursor,
  maxIterations = DEFAULT_MAX_ITERATIONS
}: CollectParams): Promise<CollectResult> => {
  // min_id drives an ascending (adjacent-page) scan: getNotifications returns
  // the oldest rows just newer than the cursor (newest-first), and we walk UP
  // toward newer rows across batches. Every other lower bound (since_id) keeps
  // the DESC scan that pages max_id down toward older rows.
  const ascending = Boolean(baseQuery.minNotificationId)
  const accumulated: Notification[] = []
  let cursor = ascending ? baseQuery.minNotificationId : startCursor
  let lastScannedId: string | undefined
  let exhausted = false

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const batch = await database.getNotifications({
      ...baseQuery,
      limit: batchSize,
      ...(ascending
        ? { minNotificationId: cursor }
        : { maxNotificationId: cursor })
    })
    if (batch.length === 0) {
      exhausted = true
      break
    }

    const filteredBatch = accountId
      ? batch.filter((n) => urlToId(n.sourceActorId) === accountId)
      : batch
    accumulated.push(...filteredBatch)

    // Advance the cursor by the raw batch edge regardless of account filtering so
    // account_id paging keeps scanning past bursts from other accounts. Track it
    // even when every row was filtered out, so the caller can keep paging. DESC
    // batches are newest→oldest, so the tail (oldest) walks down; ascending
    // batches are newest-first, so the head (newest) walks up.
    cursor = ascending ? batch[0].id : batch[batch.length - 1].id
    lastScannedId = cursor

    // Fewer rows than requested means the DB has no more matching notifications.
    if (batch.length < batchSize) {
      exhausted = true
      break
    }

    if (
      prepareGroupedNotifications(accumulated, groupedTypes).length >= limit
    ) {
      break
    }
  }

  // Ascending batches accumulate in oldest→newest window order; re-sort
  // newest-first (createdAt desc, id desc) so grouping keeps most-recent-member
  // samples and correct page_max_id cursors, matching the DESC path.
  const rawNotifications = ascending
    ? [...accumulated].sort(
        (a, b) =>
          b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
      )
    : accumulated

  return {
    rawNotifications,
    groups: prepareGroupedNotifications(rawNotifications, groupedTypes),
    exhausted,
    lastScannedId
  }
}
