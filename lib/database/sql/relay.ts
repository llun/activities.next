import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  CreateRelayParams,
  DeleteRelayParams,
  GetRelayByActorIdParams,
  GetRelayByFollowActivityIdParams,
  GetRelayByIdParams,
  GetRelayByInboxUrlParams,
  RelayData,
  RelayDatabase,
  UpdateRelayParams
} from '@/lib/types/database/operations'
import { RelayState } from '@/lib/types/domain/relay'

type SQLRelay = {
  id: string
  inboxUrl: string
  actorId: string | null
  state: string
  followActivityId: string | null
  lastError: string | null
  createdAt: number | Date | string
  updatedAt: number | Date | string
}

const toRelay = (row: SQLRelay): RelayData => ({
  id: row.id,
  inboxUrl: row.inboxUrl,
  actorId: row.actorId ?? null,
  state: RelayState.catch('idle').parse(row.state),
  followActivityId: row.followActivityId ?? null,
  lastError: row.lastError ?? null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const RelaySQLDatabaseMixin = (database: Knex): RelayDatabase => ({
  async createRelay({ inboxUrl }: CreateRelayParams) {
    const currentTime = new Date()
    const id = randomUUID()
    await database('relays').insert({
      id,
      inboxUrl,
      actorId: null,
      state: 'idle',
      followActivityId: null,
      lastError: null,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return {
      id,
      inboxUrl,
      actorId: null,
      state: 'idle',
      followActivityId: null,
      lastError: null,
      createdAt: currentTime.getTime(),
      updatedAt: currentTime.getTime()
    }
  },

  async updateRelay({
    id,
    state,
    actorId,
    followActivityId,
    lastError
  }: UpdateRelayParams) {
    const updatedCount = await database('relays')
      .where({ id })
      .update({
        ...(state !== undefined ? { state } : null),
        ...(actorId !== undefined ? { actorId } : null),
        ...(followActivityId !== undefined ? { followActivityId } : null),
        ...(lastError !== undefined ? { lastError } : null),
        updatedAt: new Date()
      })
    if (updatedCount === 0) return null

    const row = await database<SQLRelay>('relays').where({ id }).first()
    return row ? toRelay(row) : null
  },

  async deleteRelay({ id }: DeleteRelayParams) {
    const deleted = await database('relays').where({ id }).delete()
    return deleted > 0
  },

  async getRelays() {
    const rows = await database<SQLRelay>('relays').orderBy('createdAt', 'asc')
    return rows.map(toRelay)
  },

  async getRelayById({ id }: GetRelayByIdParams) {
    const row = await database<SQLRelay>('relays').where({ id }).first()
    return row ? toRelay(row) : null
  },

  async getRelayByInboxUrl({ inboxUrl }: GetRelayByInboxUrlParams) {
    const row = await database<SQLRelay>('relays').where({ inboxUrl }).first()
    return row ? toRelay(row) : null
  },

  async getRelayByActorId({ actorId }: GetRelayByActorIdParams) {
    const row = await database<SQLRelay>('relays').where({ actorId }).first()
    return row ? toRelay(row) : null
  },

  async getRelayByFollowActivityId({
    followActivityId
  }: GetRelayByFollowActivityIdParams) {
    const row = await database<SQLRelay>('relays')
      .where({ followActivityId })
      .first()
    return row ? toRelay(row) : null
  },

  async getAcceptedRelays() {
    const rows = await database<SQLRelay>('relays')
      .where({ state: 'accepted' })
      .orderBy('createdAt', 'asc')
    return rows.map(toRelay)
  }
})
