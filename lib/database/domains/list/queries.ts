import type { Selectable } from 'kysely'
import { randomUUID } from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getMastodonActors } from '@/lib/database/domains/actor/mastodon'
import {
  type ListStatusSource,
  addStatusToListTimelines,
  backfillListTimelineForMembers,
  getListTimeline
} from '@/lib/database/domains/list/timeline'
import type {
  AddListAccountsParams,
  AddListAccountsResult,
  CreateListParams,
  DeleteListParams,
  GetListAccountCountsParams,
  GetListAccountsParams,
  GetListMembersParams,
  GetListParams,
  GetListTimelineParams,
  GetListsParams,
  GetListsWithAccountParams,
  ListAccountsPage,
  ListMember,
  RemoveListAccountsParams,
  UpdateListParams
} from '@/lib/database/domains/list/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import type { Lists } from '@/lib/database/kysely/db'
import {
  chunkArray,
  getWhereInBatchSize,
  insertInChunks,
  selectInChunks
} from '@/lib/database/kysely/inList'
import { pastStoredKeyset } from '@/lib/database/kysely/keyset'
import { selectFollowTargetActorIds } from '@/lib/database/kysely/visibility/followTarget'
import { listTimelineKey } from '@/lib/services/timelines/types'
import { FollowStatus } from '@/lib/types/domain/follow'
import type { List } from '@/lib/types/domain/list'

export type { ListStatusSource } from '@/lib/database/domains/list/timeline'
export {
  addStatusToListTimelines,
  backfillListTimelineForMembers,
  getListTimeline
} from '@/lib/database/domains/list/timeline'

const toList = (row: Selectable<Lists>): List => ({
  id: row.id,
  actorId: row.actorId,
  title: row.title,
  repliesPolicy: (row.repliesPolicy ?? 'list') as List['repliesPolicy'],
  exclusive: row.exclusive,
  // Nullable in the schema, but every writer sets both.
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

const findList = (db: Db, id: string, actorId: string) =>
  db
    .selectFrom('lists')
    .selectAll()
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .executeTakeFirst()

export const createList = async (
  db: Db,
  {
    actorId,
    title,
    repliesPolicy = 'list',
    exclusive = false
  }: CreateListParams
): Promise<List> => {
  const currentTime = new Date()
  const row = {
    id: randomUUID(),
    actorId,
    title,
    repliesPolicy,
    exclusive,
    createdAt: currentTime,
    updatedAt: currentTime
  }
  await db.insertInto('lists').values(row).execute()
  return {
    ...row,
    exclusive: Boolean(exclusive),
    createdAt: currentTime.getTime(),
    updatedAt: currentTime.getTime()
  }
}

export const updateList = async (
  db: Db,
  { id, actorId, title, repliesPolicy, exclusive }: UpdateListParams
): Promise<List | null> => {
  const existing = await findList(db, id, actorId)
  if (!existing) return null

  await db
    .updateTable('lists')
    .set({
      updatedAt: new Date(),
      ...(title !== undefined ? { title } : {}),
      ...(repliesPolicy !== undefined ? { repliesPolicy } : {}),
      ...(exclusive !== undefined ? { exclusive } : {})
    })
    .where('id', '=', id)
    .where('actorId', '=', actorId)
    .execute()
  const updated = await findList(db, id, actorId)
  return updated ? toList(updated) : null
}

export const getList = async (
  db: Db,
  { id, actorId }: GetListParams
): Promise<List | null> => {
  const row = await findList(db, id, actorId)
  return row ? toList(row) : null
}

export const getLists = async (
  db: Db,
  { actorId }: GetListsParams
): Promise<List[]> => {
  const rows = await db
    .selectFrom('lists')
    .selectAll()
    .where('actorId', '=', actorId)
    .orderBy('createdAt', 'asc')
    .execute()
  return rows.map(toList)
}

export const deleteList = async (
  db: Db,
  { id, actorId }: DeleteListParams
): Promise<boolean> => {
  const existing = await findList(db, id, actorId)
  if (!existing) return false

  await inTransaction(db, async (trx) => {
    await trx.deleteFrom('list_accounts').where('listId', '=', id).execute()
    // Drop the materialized feed for this list so its rows don't linger in the
    // timelines table after the list is gone.
    await trx
      .deleteFrom('timelines')
      .where('actorId', '=', actorId)
      .where('timeline', '=', listTimelineKey(id))
      .execute()
    await trx
      .deleteFrom('lists')
      .where('id', '=', id)
      .where('actorId', '=', actorId)
      .execute()
  })
  return true
}

export const getListAccounts = async (
  db: Db,
  {
    listId,
    actorId,
    limit = PER_PAGE_LIMIT,
    maxId,
    minId,
    sinceId
  }: GetListAccountsParams
): Promise<ListAccountsPage> => {
  // min_id ascends from the cursor (the oldest members just newer than it) then
  // reverses to newest-first, returning the page adjacent to the cursor.
  // since_id / max_id / no cursor keep DESC (the newest slice above the cursor).
  const ascending = Boolean(minId)
  const direction = ascending ? 'asc' : 'desc'

  // Scope to the owner defensively so this never leaks another actor's list
  // members even if a caller forgets the route-level ownership check.
  let query = db
    .selectFrom('list_accounts')
    .select(['id', 'targetActorId'])
    .where('listId', '=', listId)
    .where('actorId', '=', actorId)

  // Membership ids are random UUIDs, so they cannot be compared with </> for
  // chronological pagination. Resolve the cursor row's createdAt and paginate
  // on that, using id only as a stable tie-breaker. Returns false when the
  // cursor row is gone (removed member / foreign id), so the caller ends
  // pagination with an empty page instead of dropping the condition — which,
  // under the ascending min_id order, would return the OLDEST members (the
  // wrong end of the list).
  const applyCursor = async (
    cursorId: string,
    operator: '<' | '>'
  ): Promise<boolean> => {
    const cursor = await db
      .selectFrom('list_accounts')
      .select('createdAt')
      .where('listId', '=', listId)
      .where('actorId', '=', actorId)
      .where('id', '=', cursorId)
      .limit(1)
      .executeTakeFirst()
    if (!cursor) return false
    const past = { createdAt: cursor.createdAt, tieBreaker: cursorId }
    query = query.where((eb) => pastStoredKeyset(eb, past, operator, 'id'))
    return true
  }

  const emptyPage = { accounts: [], nextMaxId: null, prevMinId: null }
  // min_id and since_id are both lower-bound cursors (rows newer than it); they
  // differ only in ordering, handled by `ascending` above. An unresolvable
  // cursor terminates pagination with an empty page.
  const lowerBoundId = minId || sinceId
  if (maxId && !(await applyCursor(maxId, '<'))) return emptyPage
  if (lowerBoundId && !(await applyCursor(lowerBoundId, '>'))) return emptyPage

  query = query.orderBy('createdAt', direction).orderBy('id', direction)
  // Mastodon: limit=0 returns ALL members without pagination.
  if (limit > 0) query = query.limit(limit)
  const rows = await query.execute()
  // Ascending (min_id) rows come back oldest-first; flip to the newest-first
  // response shape used by every other cursor kind.
  if (ascending) rows.reverse()
  const accounts = await getMastodonActors(
    db,
    rows.map((row) => row.targetActorId)
  )
  return {
    accounts,
    // Rows are newest-first, so the last row is the oldest (next page) and the
    // first row is the newest (previous page).
    nextMaxId: rows.length > 0 ? rows[rows.length - 1].id : null,
    prevMinId: rows.length > 0 ? rows[0].id : null
  }
}

export const getListMembers = async (
  db: Db,
  { listId, actorId, limit = PER_PAGE_LIMIT, maxId }: GetListMembersParams
): Promise<ListMember[]> => {
  let query = db
    .selectFrom('list_accounts')
    .select(['id', 'targetActorId'])
    .where('listId', '=', listId)
    .where('actorId', '=', actorId)

  if (maxId) {
    const cursor = await db
      .selectFrom('list_accounts')
      .select('createdAt')
      .where('listId', '=', listId)
      .where('actorId', '=', actorId)
      .where('id', '=', maxId)
      .limit(1)
      .executeTakeFirst()
    if (!cursor) return []
    query = query.where((eb) =>
      pastStoredKeyset(
        eb,
        { createdAt: cursor.createdAt, tieBreaker: maxId },
        '<',
        'id'
      )
    )
  }

  query = query.orderBy('createdAt', 'desc').orderBy('id', 'desc')
  if (limit > 0) query = query.limit(limit)
  return query.execute()
}

export const getListAccountCounts = async (
  db: Db,
  { actorId, listIds }: GetListAccountCountsParams
): Promise<Record<string, number>> => {
  // Seed every requested list with 0 so callers can index the result without
  // a missing-key check; lists with no members produce no grouped row below.
  const counts: Record<string, number> = {}
  for (const listId of listIds) counts[listId] = 0
  if (listIds.length === 0) return counts

  // Scope to the owner so this never counts another actor's memberships; the
  // chunks reserve the actorId binding.
  const rows = await selectInChunks(
    db,
    listIds,
    (chunk) =>
      db
        .selectFrom('list_accounts')
        .select(['listId', (eb) => eb.fn.countAll().as('count')])
        .where('actorId', '=', actorId)
        .where('listId', 'in', chunk)
        .groupBy('listId')
        .execute(),
    1
  )
  for (const row of rows) counts[row.listId] = Number(row.count)
  return counts
}

export const addListAccounts = async (
  db: Db,
  {
    listId,
    actorId,
    targetActorIds,
    requireFollowOrRequest = false
  }: AddListAccountsParams
): Promise<AddListAccountsResult> => {
  if (targetActorIds.length === 0) return { unrelatedActorIds: [] }

  const currentTime = new Date()
  const rows = targetActorIds.map((targetActorId) => ({
    id: randomUUID(),
    listId,
    actorId,
    targetActorId,
    createdAt: currentTime
  }))
  // Run the membership insert and the materialized backfill in one transaction
  // so a crash can't leave members on the list without their feed rows (or, on
  // re-add, partially backfilled). Targets already on the list are ignored so
  // repeated adds stay idempotent (matching Mastodon).
  return inTransaction(db, async (trx) => {
    if (requireFollowOrRequest) {
      // Mastodon's ListAccount admits the owner, and anyone else only with a
      // follow or a pending request behind them. updateFollowStatus removes
      // the memberships a follow backed when it ends, so the check has to be
      // atomic with the insert or a follow ending in between leaves a
      // membership nothing backs (and nothing ever removes). On PostgreSQL
      // the check locks the follow rows it reads, and under its default READ
      // COMMITTED an ending that commits first is seen by the locked re-read,
      // while one that comes later waits for this commit, so its cleanup
      // deletes what was inserted here.
      const otherActorIds = [
        ...new Set(
          targetActorIds.filter((targetActorId) => targetActorId !== actorId)
        )
      ]
      const relatedActorIds = new Set(
        await selectFollowTargetActorIds(
          trx,
          actorId,
          otherActorIds,
          [FollowStatus.enum.Accepted, FollowStatus.enum.Requested],
          { forShare: true }
        )
      )
      const unrelatedActorIds = otherActorIds.filter(
        (targetActorId) => !relatedActorIds.has(targetActorId)
      )
      if (unrelatedActorIds.length > 0) return { unrelatedActorIds }
    }

    await insertInChunks(trx, rows, (chunk) =>
      trx
        .insertInto('list_accounts')
        .values(chunk)
        .onConflict((conflict) =>
          conflict.columns(['listId', 'targetActorId']).doNothing()
        )
        .execute()
    )

    // Backfill the materialized list feed with each new member's existing
    // posts so the timeline shows recent history immediately, not just posts
    // published after they were added (at most LIST_MEMBER_BACKFILL_MAX_POSTS
    // each; the owner adding themselves gets LIST_OWNER_BACKFILL_MAX_POSTS),
    // except a member the owner has only requested to follow, whose posts wait
    // for the request to be accepted. The insert ignores rows the new-status
    // fan-out already wrote, so re-adding a member is a no-op rather than a
    // duplicate.
    await backfillListTimelineForMembers(trx, {
      listId,
      ownerId: actorId,
      targetActorIds
    })
    return { unrelatedActorIds: [] }
  })
}

export const removeListAccounts = async (
  db: Db,
  { listId, actorId, targetActorIds }: RemoveListAccountsParams
): Promise<void> => {
  if (targetActorIds.length === 0) return
  const timeline = listTimelineKey(listId)
  // Run the membership delete and the feed purge in one transaction so the two
  // can't diverge on a crash. Both deletes reserve two bindings
  // (listId+actorId / actorId+timeline) before chunking the id list. Scope to
  // the owner defensively so a caller can never delete members from a list
  // they do not own.
  await inTransaction(db, async (trx) => {
    const chunks = chunkArray(targetActorIds, getWhereInBatchSize(trx, 2))
    for (const chunk of chunks) {
      await trx
        .deleteFrom('list_accounts')
        .where('listId', '=', listId)
        .where('actorId', '=', actorId)
        .where('targetActorId', 'in', chunk)
        .execute()
    }
    // Drop the removed members' posts from the materialized list feed.
    for (const chunk of chunks) {
      await trx
        .deleteFrom('timelines')
        .where('actorId', '=', actorId)
        .where('timeline', '=', timeline)
        .where('statusActorId', 'in', chunk)
        .execute()
    }
  })
}

export const getListsWithAccount = async (
  db: Db,
  { actorId, targetActorId }: GetListsWithAccountParams
): Promise<List[]> => {
  const rows = await db
    .selectFrom('lists')
    .innerJoin('list_accounts', 'list_accounts.listId', 'lists.id')
    .selectAll('lists')
    .where('lists.actorId', '=', actorId)
    .where('list_accounts.targetActorId', '=', targetActorId)
    .orderBy('lists.createdAt', 'asc')
    .execute()
  return rows.map(toList)
}

/**
 * The list facade methods as `(db, params)` queries. getListTimeline hydrates
 * its statuses through `getStatusesByIds` (the status facade's, injected),
 * after this domain's queries and outside any transaction.
 */
export const createListQueries = (getStatusesByIds: ListStatusSource) => ({
  createList,
  updateList,
  getList,
  getLists,
  deleteList,
  getListAccounts,
  getListMembers,
  getListAccountCounts,
  addListAccounts,
  removeListAccounts,
  getListsWithAccount,
  getListTimeline: (db: Db, params: GetListTimelineParams) =>
    getListTimeline(db, getStatusesByIds, params),
  addStatusToListTimelines
})
