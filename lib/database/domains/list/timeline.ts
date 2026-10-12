import { sql } from 'kysely'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import type {
  AddStatusToListTimelinesParams,
  GetListTimelineParams
} from '@/lib/database/domains/list/types'
import type { Db } from '@/lib/database/kysely'
import type { EpochMs } from '@/lib/database/kysely/db'
import {
  chunkArray,
  getWhereInBatchSize,
  insertInChunks
} from '@/lib/database/kysely/inList'
import {
  type StoredKeysetCursor,
  pastStoredKeyset
} from '@/lib/database/kysely/keyset'
import { withoutBlockedOrMutedAuthors } from '@/lib/database/kysely/visibility/blockMute'
import { selectFollowTargetActorIds } from '@/lib/database/kysely/visibility/followTarget'
import {
  listEligibleStatus,
  listRepliesPolicyAllows
} from '@/lib/database/kysely/visibility/listEligible'
import { potentiallyReadableStatus } from '@/lib/database/kysely/visibility/potentiallyReadable'
import {
  LIST_MEMBER_BACKFILL_BATCH_SIZE,
  LIST_MEMBER_BACKFILL_MAX_POSTS,
  LIST_OWNER_BACKFILL_MAX_POSTS,
  listTimelineKey
} from '@/lib/services/timelines/types'
import { FollowStatus } from '@/lib/types/domain/follow'
import type { ListRepliesPolicy } from '@/lib/types/domain/list'
import type { Status } from '@/lib/types/domain/status'

/**
 * Where this domain gets hydrated statuses from: the status facade's
 * getStatusesByIds, injected by lib/database/sql/index.ts. It runs on the root
 * Kysely instance, so it is only called after this domain's queries, never
 * inside a transaction.
 */
export type ListStatusSource = (
  statusIds: string[],
  currentActorId?: string
) => Promise<Status[]>

type BackfillStatusRow = {
  id: string
  actorId: string | null
  createdAt: EpochMs | null
}

// A timestamp read back from a row, to write into another row: NULL stays
// NULL.
const toDate = (value: EpochMs | null) =>
  value === null ? null : new Date(value)

/**
 * Materializes the given members' existing posts into a list's `timelines`
 * partition: when members are added (addListAccounts), and again when the
 * owner's follow request to a member is accepted (updateFollowStatus). Both
 * pass their transaction, so the backfill commits or rolls back with it.
 *
 * Inserts are idempotent on the unique (actorId, timeline, statusId), so this
 * can overlap with the new-status fan-out and is a no-op for members already
 * present. Every member backfills only their most recent posts
 * (LIST_MEMBER_BACKFILL_MAX_POSTS), the owner adding themselves fewer still
 * (LIST_OWNER_BACKFILL_MAX_POSTS). A member the owner has only requested to
 * follow gets nothing yet, as in addStatusToListTimelines.
 */
export const backfillListTimelineForMembers = async (
  db: Db,
  {
    listId,
    ownerId,
    targetActorIds
  }: { listId: string; ownerId: string; targetActorIds: string[] }
): Promise<void> => {
  if (targetActorIds.length === 0) return
  const timeline = listTimelineKey(listId)
  const updatedAt = new Date()
  const materialize = async (statuses: BackfillStatusRow[]) => {
    if (statuses.length === 0) return
    const rows = statuses.map((statusRow) => ({
      actorId: ownerId,
      timeline,
      statusId: statusRow.id,
      statusActorId: statusRow.actorId,
      createdAt: toDate(statusRow.createdAt),
      updatedAt
    }))
    await insertInChunks(db, rows, (chunk) =>
      db
        .insertInto('timelines')
        .values(chunk)
        .onConflict((conflict) =>
          conflict.columns(['actorId', 'timeline', 'statusId']).doNothing()
        )
        .execute()
    )
  }

  if (targetActorIds.includes(ownerId)) {
    // Only the owner's most recent posts other than DMs: the eligibility filter
    // runs before the LIMIT so DMs, which the list never shows, cannot spend
    // the cap. The replies policy stays a read-time filter, as for every
    // member, so loosening it later shows the replies it hid — which also means
    // those replies count toward the cap.
    await materialize(
      await db
        .selectFrom('statuses')
        .select(['statuses.id', 'statuses.actorId', 'statuses.createdAt'])
        .where('statuses.actorId', '=', ownerId)
        .where((eb) => listEligibleStatus(db, eb))
        .orderBy('statuses.createdAt', 'desc')
        .orderBy('statuses.id', 'desc')
        .limit(LIST_OWNER_BACKFILL_MAX_POSTS)
        .execute()
    )
  }

  // The pending-request lookup is batched across the accounts being added (one
  // IN query per chunk); the posts themselves are read per member, below. The
  // chunk size reserves the two bindings the lookup adds to its IN list.
  const memberIds = targetActorIds.filter(
    (targetActorId) => targetActorId !== ownerId
  )
  for (const idChunk of chunkArray(memberIds, getWhereInBatchSize(db, 2))) {
    const pendingMemberIds = new Set(
      await selectFollowTargetActorIds(db, ownerId, idChunk, [
        FollowStatus.enum.Requested
      ])
    )
    const backfillMemberIds = idChunk.filter(
      (memberId) => !pendingMemberIds.has(memberId)
    )
    // Newest first, one keyset page at a time, up to the per-member cap: the
    // member's cached history is attacker-influenced (a remote actor's own
    // outbox), so it is never loaded or written in one piece.
    for (const memberId of backfillMemberIds) {
      let cursor: StoredKeysetCursor | undefined
      let remaining = LIST_MEMBER_BACKFILL_MAX_POSTS
      while (remaining > 0) {
        const pageSize = Math.min(LIST_MEMBER_BACKFILL_BATCH_SIZE, remaining)
        let page = db
          .selectFrom('statuses')
          .select(['id', 'actorId', 'createdAt'])
          .where('actorId', '=', memberId)
        if (cursor) {
          const past = cursor
          page = page.where((eb) => pastStoredKeyset(eb, past, '<', 'id'))
        }
        const rows = await page
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
          .limit(pageSize)
          .execute()
        await materialize(rows)
        if (rows.length < pageSize) break
        const last = rows[rows.length - 1]
        cursor = { createdAt: last.createdAt, tieBreaker: last.id }
        remaining -= rows.length
      }
    }
  }
}

/**
 * The list feed, read from the materialized `timelines` partition (kept in
 * sync by addStatusToListTimelines on new posts and by the addListAccounts
 * backfill), newest first, hydrated through the status facade.
 */
export const getListTimeline = async (
  db: Db,
  getStatusesByIds: ListStatusSource,
  {
    listId,
    actorId,
    limit = PER_PAGE_LIMIT,
    maxStatusId,
    minStatusId,
    sinceStatusId
  }: GetListTimelineParams
): Promise<Status[]> => {
  // The list's replies_policy governs which replies appear. Default to 'list'
  // (Mastodon's default) when the row is missing so behaviour is well-defined.
  const listRow = await db
    .selectFrom('lists')
    .select('repliesPolicy')
    .where('id', '=', listId)
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  const repliesPolicy = (listRow?.repliesPolicy ?? 'list') as ListRepliesPolicy

  // The partition is seeked and ordered by the (actorId, timeline, createdAt)
  // index, the same indexed read the home feed uses. The candidate set is every
  // status whose author is a list member, except the owner as a member of their
  // own list, whose history is backfilled only up to
  // LIST_OWNER_BACKFILL_MAX_POSTS, and a member the owner has only requested to
  // follow, who has none until the request is accepted. Every filter below is
  // a pure WHERE/EXISTS on the joined statuses row and runs before LIMIT, so a
  // filtered row never shortens the page:
  // - the owner's visibility: a member's posts addressed to others never show;
  // - list eligibility: no direct messages, the owner's own included;
  // - the list's replies_policy;
  // - the statuses of accounts the owner blocks, is blocked by, or mutes.
  const timeline = listTimelineKey(listId)
  const ascending = Boolean(minStatusId)
  const direction = ascending ? 'asc' : 'desc'
  let query = withoutBlockedOrMutedAuthors(
    db
      .selectFrom('timelines')
      .innerJoin('statuses', 'statuses.id', 'timelines.statusId')
      // Scope to the owner defensively so a caller can never read another
      // actor's list timeline even if they know the listId.
      .where('timelines.actorId', '=', actorId)
      .where('timelines.timeline', '=', timeline)
      .where((eb) => potentiallyReadableStatus(db, eb, actorId))
      .where((eb) => listEligibleStatus(db, eb))
      .where((eb) =>
        listRepliesPolicyAllows(eb, { repliesPolicy, listId, ownerId: actorId })
      ),
    actorId,
    Date.now()
  )

  // Resolve the cursor from this list's timelines row (id + createdAt),
  // mirroring the home feed's lookupTimelineCursor, so pagination matches the
  // index order. Fall back to the status's createdAt (without the row-id
  // tie-breaker) if the row was already purged, so pagination still advances.
  // Returns false when neither exists, so the caller ends pagination with an
  // empty page instead of re-returning the newest page.
  const applyCursor = async (
    cursorStatusId: string,
    operator: '<' | '>'
  ): Promise<boolean> => {
    let cursor: StoredKeysetCursor | undefined
    const row = await db
      .selectFrom('timelines')
      .select(['id', 'createdAt'])
      .where('actorId', '=', actorId)
      .where('timeline', '=', timeline)
      .where('statusId', '=', cursorStatusId)
      .limit(1)
      .executeTakeFirst()
    if (row) {
      cursor = { createdAt: row.createdAt, tieBreaker: row.id }
    } else {
      const statusRow = await db
        .selectFrom('statuses')
        .select('createdAt')
        .where('id', '=', cursorStatusId)
        .limit(1)
        .executeTakeFirst()
      if (!statusRow) return false
      cursor = { createdAt: statusRow.createdAt, tieBreaker: null }
    }
    const past = cursor
    query = query.where((eb) =>
      pastStoredKeyset(
        eb,
        past,
        operator,
        'timelines.id',
        'timelines.createdAt'
      )
    )
    return true
  }

  const lowerBoundStatusId = minStatusId || sinceStatusId
  if (maxStatusId && !(await applyCursor(maxStatusId, '<'))) return []
  if (lowerBoundStatusId && !(await applyCursor(lowerBoundStatusId, '>'))) {
    return []
  }

  // A status appears at most once: list_accounts is unique on
  // (listId, targetActorId), so a member's status is materialized once per
  // list, and the join to statuses (by primary key) cannot duplicate it.
  const rows = await query
    .select('statuses.id')
    .orderBy('timelines.createdAt', direction)
    .orderBy('timelines.id', direction)
    .limit(limit)
    .execute()
  // Ascending (min_id) rows come back oldest-first; flip to newest-first.
  if (ascending) rows.reverse()
  const statusIds = rows.map((row) => row.id)
  if (statusIds.length === 0) return []
  // getStatusesByIds preserves the input order, so the ordering above is kept.
  // Visibility is already enforced on the query; passing the owner hydrates
  // their action state (liked, bookmarked, boosted).
  return getStatusesByIds(statusIds, actorId)
}

/**
 * Fans a new status into every list whose membership includes its author,
 * except one whose owner is still waiting on a follow request to them.
 */
export const addStatusToListTimelines = async (
  db: Db,
  { status }: AddStatusToListTimelinesParams
): Promise<void> => {
  // Each list_accounts row already carries the owner (actorId) and listId, so
  // no join to `lists` is needed; targetActorId is indexed for this lookup. A
  // membership still waiting on the owner's follow request gets nothing:
  // Mastodon (≥ 4.2) lets a pending request join a list, but its
  // lists_for_local_distribution reaches only a membership backed by a follow
  // or the owner's own, and updateFollowStatus backfills the member once the
  // request is accepted. The owner's own posts always pass — their membership
  // of their own list never rides on a follow, even a pending one of
  // themselves.
  const memberships = await db
    .selectFrom('list_accounts')
    .select(['list_accounts.listId', 'list_accounts.actorId'])
    .where('list_accounts.targetActorId', '=', status.actorId)
    .where((eb) =>
      eb.or([
        eb('list_accounts.actorId', '=', status.actorId),
        eb.not(
          eb.exists(
            eb
              .selectFrom('follows')
              .select(sql.lit(1).as('one'))
              .whereRef('follows.actorId', '=', 'list_accounts.actorId')
              .where('follows.targetActorId', '=', status.actorId)
              .where('follows.status', '=', FollowStatus.enum.Requested)
          )
        )
      ])
    )
    .execute()
  if (memberships.length === 0) return

  const createdAt = new Date(status.createdAt)
  const updatedAt = new Date()
  const rows = memberships.map((membership) => ({
    actorId: membership.actorId,
    timeline: listTimelineKey(membership.listId),
    statusId: status.id,
    statusActorId: status.actorId,
    createdAt,
    updatedAt
  }))
  // Idempotent on the unique (actorId, timeline, statusId): a repeated fan-out
  // (an edit re-running addStatusToTimelines) or overlap with a backfill is
  // ignored rather than duplicated.
  await insertInChunks(db, rows, (chunk) =>
    db
      .insertInto('timelines')
      .values(chunk)
      .onConflict((conflict) =>
        conflict.columns(['actorId', 'timeline', 'statusId']).doNothing()
      )
      .execute()
  )
}
