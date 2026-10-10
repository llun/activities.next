import { randomUUID } from 'node:crypto'

import type {
  CreateRelayParams,
  DeleteRelayParams,
  GetRelayByActorIdParams,
  GetRelayByFollowActivityIdParams,
  GetRelayByIdParams,
  RelayData,
  UpdateRelayParams
} from '@/lib/database/domains/relay/types'
import type { Db } from '@/lib/database/kysely'
import { RelayState } from '@/lib/types/domain/relay'

const COLUMNS = [
  'id',
  'inboxUrl',
  'actorId',
  'state',
  'followActivityId',
  'lastError',
  'createdAt',
  'updatedAt'
] as const

type Row = {
  id: string
  inboxUrl: string
  actorId: string | null
  state: string
  followActivityId: string | null
  lastError: string | null
  // Nullable in the schema, but every writer sets them.
  createdAt: number | null
  updatedAt: number | null
}

const toRelay = (row: Row): RelayData => ({
  id: row.id,
  inboxUrl: row.inboxUrl,
  actorId: row.actorId ?? null,
  state: RelayState.catch('idle').parse(row.state),
  followActivityId: row.followActivityId ?? null,
  lastError: row.lastError ?? null,
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

export const createRelay = async (
  db: Db,
  { inboxUrl }: CreateRelayParams
): Promise<RelayData> => {
  const currentTime = new Date()
  const id = randomUUID()
  await db
    .insertInto('relays')
    .values({
      id,
      inboxUrl,
      actorId: null,
      state: 'idle',
      followActivityId: null,
      lastError: null,
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()
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
}

export const getRelayById = async (
  db: Db,
  { id }: GetRelayByIdParams
): Promise<RelayData | null> => {
  const row = await db
    .selectFrom('relays')
    .select(COLUMNS)
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  return row ? toRelay(row) : null
}

export const updateRelay = async (
  db: Db,
  { id, state, actorId, followActivityId, lastError }: UpdateRelayParams
): Promise<RelayData | null> => {
  const { numUpdatedRows } = await db
    .updateTable('relays')
    .set({
      ...(state !== undefined ? { state } : null),
      ...(actorId !== undefined ? { actorId } : null),
      ...(followActivityId !== undefined ? { followActivityId } : null),
      ...(lastError !== undefined ? { lastError } : null),
      updatedAt: new Date()
    })
    .where('id', '=', id)
    .executeTakeFirst()
  if (Number(numUpdatedRows) === 0) return null

  return getRelayById(db, { id })
}

export const deleteRelay = async (
  db: Db,
  { id }: DeleteRelayParams
): Promise<boolean> => {
  const { numDeletedRows } = await db
    .deleteFrom('relays')
    .where('id', '=', id)
    .executeTakeFirst()
  return Number(numDeletedRows) > 0
}

export const getRelays = async (db: Db): Promise<RelayData[]> => {
  const rows = await db
    .selectFrom('relays')
    .select(COLUMNS)
    .orderBy('createdAt', 'asc')
    .execute()
  return rows.map(toRelay)
}

export const getRelayByActorId = async (
  db: Db,
  { actorId }: GetRelayByActorIdParams
): Promise<RelayData | null> => {
  const row = await db
    .selectFrom('relays')
    .select(COLUMNS)
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  return row ? toRelay(row) : null
}

export const getRelayByFollowActivityId = async (
  db: Db,
  { followActivityId }: GetRelayByFollowActivityIdParams
): Promise<RelayData | null> => {
  const row = await db
    .selectFrom('relays')
    .select(COLUMNS)
    .where('followActivityId', '=', followActivityId)
    .limit(1)
    .executeTakeFirst()
  return row ? toRelay(row) : null
}

export const getAcceptedRelays = async (db: Db): Promise<RelayData[]> => {
  const rows = await db
    .selectFrom('relays')
    .select(COLUMNS)
    .where('state', '=', 'accepted')
    .orderBy('createdAt', 'asc')
    .execute()
  return rows.map(toRelay)
}

export const relayQueries = {
  createRelay,
  updateRelay,
  deleteRelay,
  getRelays,
  getRelayById,
  getRelayByActorId,
  getRelayByFollowActivityId,
  getAcceptedRelays
}
