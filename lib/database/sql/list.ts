import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { Mastodon } from '@/lib/types/activitypub'
import {
  AddListAccountsParams,
  CreateListParams,
  DeleteListParams,
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
  getStatusesByIds: (statusIds: string[]) => Promise<Status[]>
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
    limit = PER_PAGE_LIMIT,
    maxId,
    sinceId
  }: GetListAccountsParams) {
    const query = database('list_accounts')
      .where('listId', listId)
      .orderBy('createdAt', 'desc')
      .limit(limit)

    if (maxId) query.andWhere('id', '<', maxId)
    if (sinceId) query.andWhere('id', '>', sinceId)

    const rows = await query.select('targetActorId')
    const targetActorIds = rows.map((row) => row.targetActorId as string)
    return getMastodonActors(targetActorIds)
  },

  async addListAccounts({
    listId,
    actorId,
    targetActorIds
  }: AddListAccountsParams) {
    const currentTime = new Date()
    for (const targetActorId of targetActorIds) {
      try {
        await database('list_accounts').insert({
          id: randomUUID(),
          listId,
          actorId,
          targetActorId,
          createdAt: currentTime
        })
      } catch (error) {
        // A target already on the list is a no-op, matching Mastodon's behavior
        // of treating repeated adds idempotently.
        if (!isUniqueConstraintError(error)) throw error
      }
    }
  },

  async removeListAccounts({
    listId,
    targetActorIds
  }: RemoveListAccountsParams) {
    if (targetActorIds.length === 0) return
    await database('list_accounts')
      .where('listId', listId)
      .whereIn('targetActorId', targetActorIds)
      .delete()
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
      .orderBy('statuses.createdAt', 'desc')
      .orderBy('statuses.id', 'desc')
      .limit(limit)
      .select('statuses.id')
      .distinct()

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
    return getStatusesByIds(statusIds)
  }
})
