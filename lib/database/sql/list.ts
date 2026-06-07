import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  chunkArray,
  getInsertBatchSize,
  getWhereInBatchSize
} from '@/lib/database/sql/utils/knex'
import { applyPotentiallyReadableStatusFilter } from '@/lib/database/sql/utils/statusVisibility'
import { Mastodon } from '@/lib/types/activitypub'
import {
  AddListAccountsParams,
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
import { List } from '@/lib/types/domain/list'
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
    // Batch insert, chunked to stay under SQLite's 999 bound-parameter limit
    // (the batch size is derived from the column count). Targets already on the
    // list are ignored so repeated adds stay idempotent (matching Mastodon)
    // without per-row round-trips.
    const batchSize = getInsertBatchSize(database, rows[0])
    for (const chunk of chunkArray(rows, batchSize)) {
      await database('list_accounts')
        .insert(chunk)
        .onConflict(['listId', 'targetActorId'])
        .ignore()
    }
  },

  async removeListAccounts({
    listId,
    actorId,
    targetActorIds
  }: RemoveListAccountsParams) {
    if (targetActorIds.length === 0) return
    // Scope to the owner defensively so a caller can never delete members from
    // a list they do not own. Chunk the whereIn list to stay under SQLite's 999
    // bound-parameter limit, reserving two bindings for listId + actorId.
    const batchSize = getWhereInBatchSize(database, 2)
    for (const chunk of chunkArray(targetActorIds, batchSize)) {
      await database('list_accounts')
        .where({ listId, actorId })
        .whereIn('targetActorId', chunk)
        .delete()
    }
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
    const query = database('statuses')
      .innerJoin(
        'list_accounts',
        'list_accounts.targetActorId',
        'statuses.actorId'
      )
      .where('list_accounts.listId', listId)
      // Scope to the owner defensively so a caller can never read another
      // actor's list timeline even if they know the listId.
      .andWhere('list_accounts.actorId', actorId)
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
    query
      .orderBy('statuses.createdAt', 'desc')
      .orderBy('statuses.id', 'desc')
      .limit(limit)
      .select('statuses.id')

    // A status appears at most once: list_accounts is unique on
    // (listId, targetActorId), so the join cannot duplicate a status row.
    // Avoid SELECT DISTINCT, which on PostgreSQL would require every ORDER BY
    // column (statuses.createdAt) to also appear in the select list.
    // Status IDs are URIs (not chronologically ordered), so paginate on the
    // referenced status's createdAt with the id as a stable tie-breaker.
    const applyCursor = async (
      cursorStatusId: string,
      direction: 'older' | 'newer'
    ) => {
      const cursor = await database('statuses')
        .where('id', cursorStatusId)
        .select('createdAt')
        .first<{ createdAt: number | Date }>()
      if (!cursor) return
      const operator = direction === 'older' ? '<' : '>'
      query.andWhere((builder) => {
        builder
          .where('statuses.createdAt', operator, cursor.createdAt)
          .orWhere((tie) => {
            tie
              .where('statuses.createdAt', cursor.createdAt)
              .andWhere('statuses.id', operator, cursorStatusId)
          })
      })
    }

    if (maxStatusId) await applyCursor(maxStatusId, 'older')
    if (minStatusId) await applyCursor(minStatusId, 'newer')

    const rows = await query
    const statusIds = rows.map((row) => row.id as string)
    if (statusIds.length === 0) return []
    // getStatusesByIds preserves the input order (it re-maps results over the
    // requested ids), so the createdAt-desc ordering established above is kept.
    // Visibility is already enforced on the query above; pass the owner here so
    // their action state (isActorLiked/isActorBookmarked/announce) is hydrated —
    // otherwise the timeline would render every post as un-acted.
    return getStatusesByIds(statusIds, actorId)
  }
})
