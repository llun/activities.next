import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { applyBlockMuteFilter } from '@/lib/database/sql/utils/blockMuteFilter'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  chunkArray,
  getInsertBatchSize,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import { applyListRepliesPolicyFilter } from '@/lib/database/sql/utils/listRepliesPolicy'
import { applyPotentiallyReadableStatusFilter } from '@/lib/database/sql/utils/statusVisibility'
import { listTimelineKey } from '@/lib/services/timelines/types'
import { Mastodon } from '@/lib/types/activitypub'
import {
  AddListAccountsParams,
  AddStatusToListTimelinesParams,
  CreateListParams,
  DeleteListParams,
  GetListAccountCountsParams,
  GetListAccountsParams,
  GetListParams,
  GetListTimelineParams,
  GetListsParams,
  GetListsWithAccountParams,
  ListDatabase,
  RemoveListAccountsParams,
  UpdateListParams
} from '@/lib/types/database/operations'
import { List, ListRepliesPolicy } from '@/lib/types/domain/list'
import { Status } from '@/lib/types/domain/status'

type SQLList = {
  id: string
  actorId: string
  title: string
  repliesPolicy: string
  exclusive: boolean | number
  createdAt: number | Date
  updatedAt: number | Date
}

const fixListRow = (row: SQLList): List => ({
  id: row.id,
  actorId: row.actorId,
  title: row.title,
  repliesPolicy: (row.repliesPolicy ?? 'list') as List['repliesPolicy'],
  exclusive: Boolean(row.exclusive),
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

// Materialize the given members' existing posts into a list's `timelines`
// partition. Used to backfill full history when members are added (and by the
// one-time backfill migration via the same column shape). Inserts are idempotent
// on the unique (actorId, timeline, statusId), so it can safely overlap with the
// new-status fan-out and is a no-op for members already present.
const backfillListTimelineForMembers = async ({
  database,
  listId,
  ownerId,
  targetActorIds
}: {
  database: Knex
  listId: string
  ownerId: string
  targetActorIds: string[]
}): Promise<void> => {
  if (targetActorIds.length === 0) return
  const timeline = listTimelineKey(listId)
  const updatedAt = new Date()
  // Fetch the added members' posts in chunked IN queries rather than one query
  // per member (avoids an N+1 across the accounts being added). Each chunk's rows
  // carry statusActorId from the status itself, so a single pass materializes the
  // whole chunk.
  const whereInBatchSize = getWhereInBatchSize(database, 0)
  for (const idChunk of chunkArray(targetActorIds, whereInBatchSize)) {
    const statuses = await database('statuses')
      .whereIn('actorId', idChunk)
      .select('id', 'actorId', 'createdAt')
    if (statuses.length === 0) continue
    const rows = statuses.map((statusRow) => ({
      actorId: ownerId,
      timeline,
      statusId: statusRow.id as string,
      statusActorId: statusRow.actorId as string,
      createdAt: new Date(getCompatibleTime(statusRow.createdAt)),
      updatedAt
    }))
    const batchSize = getInsertBatchSize(database, rows[0])
    for (const chunk of chunkArray(rows, batchSize)) {
      await database('timelines')
        .insert(chunk)
        .onConflict(['actorId', 'timeline', 'statusId'])
        .ignore()
    }
  }
}

export const ListSQLDatabaseMixin = (
  database: Knex,
  getMastodonActors: (actorIds: string[]) => Promise<Mastodon.Account[]>,
  getStatusesByIds: (
    statusIds: string[],
    currentActorId?: string
  ) => Promise<Status[]>
): ListDatabase => ({
  async createList({
    actorId,
    title,
    repliesPolicy = 'list',
    exclusive = false
  }: CreateListParams) {
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
    await database('lists').insert(row)
    return fixListRow(row as unknown as SQLList)
  },

  async updateList({
    id,
    actorId,
    title,
    repliesPolicy,
    exclusive
  }: UpdateListParams) {
    const existing = await database<SQLList>('lists')
      .where({ id, actorId })
      .first()
    if (!existing) return null

    const updates: Partial<SQLList> = { updatedAt: new Date() }
    if (title !== undefined) updates.title = title
    if (repliesPolicy !== undefined) updates.repliesPolicy = repliesPolicy
    if (exclusive !== undefined) updates.exclusive = exclusive

    await database('lists').where({ id, actorId }).update(updates)
    const updated = await database<SQLList>('lists')
      .where({ id, actorId })
      .first()
    return updated ? fixListRow(updated) : null
  },

  async getList({ id, actorId }: GetListParams) {
    const row = await database<SQLList>('lists').where({ id, actorId }).first()
    return row ? fixListRow(row) : null
  },

  async getLists({ actorId }: GetListsParams) {
    const rows = await database<SQLList>('lists')
      .where({ actorId })
      .orderBy('createdAt', 'asc')
    return rows.map(fixListRow)
  },

  async deleteList({ id, actorId }: DeleteListParams) {
    const existing = await database<SQLList>('lists')
      .where({ id, actorId })
      .first()
    if (!existing) return false

    await database.transaction(async (trx) => {
      await trx('list_accounts').where('listId', id).delete()
      // Drop the materialized feed for this list so its rows don't linger in the
      // timelines table after the list is gone.
      await trx('timelines')
        .where({ actorId, timeline: listTimelineKey(id) })
        .delete()
      await trx('lists').where({ id, actorId }).delete()
    })
    return true
  },

  async getListAccounts({
    listId,
    actorId,
    limit = PER_PAGE_LIMIT,
    maxId,
    sinceId
  }: GetListAccountsParams) {
    // Scope to the owner defensively so this never leaks another actor's list
    // members even if a caller forgets the route-level ownership check.
    const query = database('list_accounts')
      .where({ listId, actorId })
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)

    // Membership ids are random UUIDs, so they cannot be compared with </> for
    // chronological pagination. Resolve the cursor row's createdAt and paginate
    // on that, using id only as a stable tie-breaker.
    const applyCursor = async (
      cursorId: string,
      direction: 'older' | 'newer'
    ) => {
      const cursor = await database('list_accounts')
        .where({ listId, actorId, id: cursorId })
        .select('createdAt')
        .first<{ createdAt: number | Date }>()
      if (!cursor) return
      const operator = direction === 'older' ? '<' : '>'
      query.andWhere((builder) => {
        builder
          .where('createdAt', operator, cursor.createdAt)
          .orWhere((tie) => {
            tie
              .where('createdAt', cursor.createdAt)
              .andWhere('id', operator, cursorId)
          })
      })
    }

    if (maxId) await applyCursor(maxId, 'older')
    if (sinceId) await applyCursor(sinceId, 'newer')

    const rows = await query.select('id', 'targetActorId')
    const targetActorIds = rows.map((row) => row.targetActorId as string)
    const accounts = await getMastodonActors(targetActorIds)
    return {
      accounts,
      // Rows are newest-first, so the last row is the oldest (next page) and the
      // first row is the newest (previous page).
      nextMaxId: rows.length > 0 ? (rows[rows.length - 1].id as string) : null,
      prevMinId: rows.length > 0 ? (rows[0].id as string) : null
    }
  },

  async getListAccountCounts({ actorId, listIds }: GetListAccountCountsParams) {
    // Seed every requested list with 0 so callers can index the result without
    // a missing-key check; lists with no members produce no grouped row below.
    const counts: Record<string, number> = {}
    for (const listId of listIds) counts[listId] = 0
    if (listIds.length === 0) return counts

    // Scope to the owner so this never counts another actor's memberships, and
    // chunk the `whereIn` to stay under SQLite's bound-parameter limit.
    for (const chunk of chunkArray(listIds, getWhereInBatchSize(database, 1))) {
      const rows = await database('list_accounts')
        .where({ actorId })
        .whereIn('listId', chunk)
        .groupBy('listId')
        .select('listId')
        .count<{ listId: string; count: string | number }[]>('* as count')
      for (const row of rows) {
        counts[row.listId as string] = Number(row.count)
      }
    }
    return counts
  },

  async addListAccounts({
    listId,
    actorId,
    targetActorIds
  }: AddListAccountsParams) {
    if (targetActorIds.length === 0) return

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
    await database.transaction(async (trx) => {
      // Batch insert, chunked to stay under SQLite's 999 bound-parameter limit
      // (the batch size is derived from the column count).
      const batchSize = getInsertBatchSize(trx, rows[0])
      for (const chunk of chunkArray(rows, batchSize)) {
        await trx('list_accounts')
          .insert(chunk)
          .onConflict(['listId', 'targetActorId'])
          .ignore()
      }

      // Backfill the materialized list feed with each new member's existing posts
      // so the timeline shows full history immediately (matching the old live
      // join), not just posts published after they were added. onConflict ignores
      // any rows the new-status fan-out already wrote, so re-adding a member is a
      // no-op rather than a duplicate.
      await backfillListTimelineForMembers({
        database: trx,
        listId,
        ownerId: actorId,
        targetActorIds
      })
    })
  },

  async removeListAccounts({
    listId,
    actorId,
    targetActorIds
  }: RemoveListAccountsParams) {
    if (targetActorIds.length === 0) return
    const timeline = listTimelineKey(listId)
    // Run the membership delete and the feed purge in one transaction so the two
    // can't diverge on a crash. Both whereIn deletes reserve two bindings
    // (listId+actorId / actorId+timeline) before chunking the id list to stay
    // under SQLite's 999 bound-parameter limit. Scope to the owner defensively so
    // a caller can never delete members from a list they do not own.
    await database.transaction(async (trx) => {
      const batchSize = getWhereInBatchSize(trx, 2)
      for (const chunk of chunkArray(targetActorIds, batchSize)) {
        await trx('list_accounts')
          .where({ listId, actorId })
          .whereIn('targetActorId', chunk)
          .delete()
      }
      // Drop the removed members' posts from the materialized list feed.
      for (const chunk of chunkArray(targetActorIds, batchSize)) {
        await trx('timelines')
          .where({ actorId, timeline })
          .whereIn('statusActorId', chunk)
          .delete()
      }
    })
  },

  async getListsWithAccount({
    actorId,
    targetActorId
  }: GetListsWithAccountParams) {
    const rows = await database<SQLList>('lists')
      .join('list_accounts', 'list_accounts.listId', 'lists.id')
      .where('lists.actorId', actorId)
      .andWhere('list_accounts.targetActorId', targetActorId)
      .orderBy('lists.createdAt', 'asc')
      .select('lists.*')
    return rows.map(fixListRow)
  },

  async getListTimeline({
    listId,
    actorId,
    limit = PER_PAGE_LIMIT,
    maxStatusId,
    minStatusId
  }: GetListTimelineParams) {
    // The list's replies_policy governs which replies appear. Default to 'list'
    // (Mastodon's default) when the row is missing so behaviour is well-defined.
    const listRow = await database('lists')
      .where('id', listId)
      .andWhere('actorId', actorId)
      .first<{ repliesPolicy: string | null }>()
    const repliesPolicy = (listRow?.repliesPolicy ??
      'list') as ListRepliesPolicy

    // Read the list feed from the materialized `timelines` partition (kept in
    // sync by addStatusToListTimelines on new posts and by the addListAccounts
    // backfill) instead of a live statuses⋈list_accounts join. The partition is
    // seeked and ordered by the (actorId, timeline, createdAt) index, so this is
    // the same fast indexed read the home feed uses. The candidate set is
    // identical to the old join — every status whose author is a list member — so
    // the visibility / replies-policy / block-mute filters below (still applied
    // pre-LIMIT against the joined statuses row) produce the same result.
    const timeline = listTimelineKey(listId)
    const query = database('timelines')
      .innerJoin('statuses', 'statuses.id', 'timelines.statusId')
      // Scope to the owner defensively so a caller can never read another
      // actor's list timeline even if they know the listId.
      .where('timelines.actorId', actorId)
      .andWhere('timelines.timeline', timeline)
    // Apply the owner's visibility before LIMIT so the page counts only
    // statuses they may read — a member's direct/non-public posts addressed to
    // others never appear, and the limit isn't spent on rows that would be
    // filtered out afterwards (which could otherwise cut a page short or halt
    // pagination early). The filter is pure WHERE/EXISTS, so it composes with
    // the join without changing row cardinality.
    applyPotentiallyReadableStatusFilter({
      database,
      query,
      visibleToActorId: actorId
    })
    // Honour the list's replies_policy on the same pre-LIMIT pass.
    applyListRepliesPolicyFilter({
      database,
      query,
      repliesPolicy,
      listId,
      ownerId: actorId
    })
    // Drop statuses from blocked/muted accounts, like the home feed does — also
    // pre-LIMIT so a filtered author never shortens the page.
    applyBlockMuteFilter({
      database,
      query,
      viewerActorId: actorId,
      now: Date.now()
    })
    // Order on the timelines partition's own (createdAt, id) — the columns of
    // timelinesActorIdTimelineCreatedAtIndex — so ORDER BY ... LIMIT is served by
    // an index walk that stops at the page boundary (the same top-N read the home
    // feed uses), rather than sorting the whole filtered partition. timelines.
    // createdAt mirrors statuses.createdAt (both written as new Date(status.
    // createdAt) on every write path) and timelines.id is a monotonic tie-breaker.
    query
      .orderBy('timelines.createdAt', 'desc')
      .orderBy('timelines.id', 'desc')
      .limit(limit)
      .select('statuses.id')

    // A status appears at most once: list_accounts is unique on
    // (listId, targetActorId), so a member's status is materialized once per
    // list, and the join to statuses (by primary key) cannot duplicate it.
    // Avoid SELECT DISTINCT, which on PostgreSQL would require every ORDER BY
    // column to also appear in the select list.
    // Resolve the cursor from this list's timelines row (id + createdAt),
    // mirroring the home feed's lookupTimelineCursor, so pagination matches the
    // index order. Fall back to the status's createdAt (without the row-id
    // tie-breaker) if the row was already purged, so pagination still advances.
    // Returns false when neither exists, so the caller ends pagination with an
    // empty page instead of silently dropping the WHERE and re-returning the
    // newest page (an infinite loop). Mirrors `if (maxStatusId && !maxRow) []`.
    const applyCursor = async (
      cursorStatusId: string,
      direction: 'older' | 'newer'
    ): Promise<boolean> => {
      let cursor = await database('timelines')
        .where('actorId', actorId)
        .where('timeline', timeline)
        .where('statusId', cursorStatusId)
        .select('id', 'createdAt')
        .first<{ id: number | null; createdAt: number | Date }>()
      if (!cursor) {
        const statusRow = await database('statuses')
          .where('id', cursorStatusId)
          .select('createdAt')
          .first<{ createdAt: number | Date }>()
        if (!statusRow) return false
        cursor = { id: null, createdAt: statusRow.createdAt }
      }
      const operator = direction === 'older' ? '<' : '>'
      const { id: cursorId, createdAt: cursorCreatedAt } = cursor
      query.andWhere((builder) => {
        builder.where('timelines.createdAt', operator, cursorCreatedAt)
        // Break createdAt ties by row id only when we resolved one — the cursor
        // row may be gone (purged), leaving just the status's createdAt. Apply
        // the orWhere conditionally so an unresolved id never produces an empty
        // Knex group (which would emit invalid `OR ()`).
        if (cursorId !== null) {
          builder.orWhere((tie) => {
            tie
              .where('timelines.createdAt', cursorCreatedAt)
              .andWhere('timelines.id', operator, cursorId)
          })
        }
      })
      return true
    }

    if (maxStatusId && !(await applyCursor(maxStatusId, 'older'))) return []
    if (minStatusId && !(await applyCursor(minStatusId, 'newer'))) return []

    const rows = await query
    const statusIds = rows.map((row) => row.id as string)
    if (statusIds.length === 0) return []
    // getStatusesByIds preserves the input order (it re-maps results over the
    // requested ids), so the createdAt-desc ordering established above is kept.
    // Visibility is already enforced on the query above; pass the owner here so
    // their action state (isActorLiked/isActorBookmarked/announce) is hydrated —
    // otherwise the timeline would render every post as un-acted.
    return getStatusesByIds(statusIds, actorId)
  },

  async addStatusToListTimelines({
    status
  }: AddStatusToListTimelinesParams): Promise<void> {
    // Find every list whose membership includes this status's author. Each
    // list_accounts row already carries the owner (actorId) and listId, so no
    // join to `lists` is needed; targetActorId is indexed for this lookup.
    const memberships = await database('list_accounts')
      .where('targetActorId', status.actorId)
      .select('listId', 'actorId')
    if (memberships.length === 0) return

    const createdAt = new Date(status.createdAt)
    const updatedAt = new Date()
    const rows = memberships.map((membership) => ({
      actorId: membership.actorId as string,
      timeline: listTimelineKey(membership.listId as string),
      statusId: status.id,
      statusActorId: status.actorId,
      createdAt,
      updatedAt
    }))
    // Idempotent on the unique (actorId, timeline, statusId): a repeated fan-out
    // (e.g. an edit re-running addStatusToTimelines) or overlap with a backfill
    // is ignored rather than duplicated.
    const batchSize = getInsertBatchSize(database, rows[0])
    for (const chunk of chunkArray(rows, batchSize)) {
      await database('timelines')
        .insert(chunk)
        .onConflict(['actorId', 'timeline', 'statusId'])
        .ignore()
    }
  }
})
