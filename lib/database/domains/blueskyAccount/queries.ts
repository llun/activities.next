import type { Selectable } from 'kysely'

import type {
  BlueskyAccount,
  BlueskyAuthType,
  SaveBlueskyAccountParams
} from '@/lib/database/domains/blueskyAccount/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import type { BlueskyAccounts } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'

const toAccount = (row: Selectable<BlueskyAccounts>): BlueskyAccount => ({
  actorId: row.actorId,
  did: row.did,
  handle: row.handle,
  pdsUrl: row.pdsUrl,
  authType: row.authType as BlueskyAuthType,
  domainHandle: Boolean(row.domainHandle),
  instanceHandle: row.instanceHandle ?? null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const getBlueskyAccount = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<BlueskyAccount | null> => {
  const row = await db
    .selectFrom('bluesky_accounts')
    .selectAll()
    .where('actorId', '=', actorId)
    .executeTakeFirst()
  return row ? toAccount(row) : null
}

export const getBlueskyAccountByDid = async (
  db: Db,
  { did }: { did: string }
): Promise<BlueskyAccount | null> => {
  const row = await db
    .selectFrom('bluesky_accounts')
    .selectAll()
    .where('did', '=', did)
    .executeTakeFirst()
  return row ? toAccount(row) : null
}

export const getBlueskyAccountByInstanceHandle = async (
  db: Db,
  { host }: { host: string }
): Promise<BlueskyAccount | null> => {
  const row = await db
    .selectFrom('bluesky_accounts')
    .selectAll()
    .where('instanceHandle', '=', host.toLowerCase())
    .executeTakeFirst()
  return row ? toAccount(row) : null
}

export const saveBlueskyAccount = async (
  db: Db,
  params: SaveBlueskyAccountParams
): Promise<'saved' | 'did_taken'> => {
  try {
    return await inTransaction(db, async (trx) => {
      const holder = await trx
        .selectFrom('bluesky_accounts')
        .select('actorId')
        .where('did', '=', params.did)
        .executeTakeFirst()
      if (holder && holder.actorId !== params.actorId) return 'did_taken'

      const previous = await trx
        .selectFrom('bluesky_accounts')
        .select('did')
        .where('actorId', '=', params.actorId)
        .executeTakeFirst()
      if (previous && previous.did !== params.did) {
        await trx
          .deleteFrom('bluesky_sessions')
          .where('did', '=', previous.did)
          .execute()
      }
      await trx
        .deleteFrom('bluesky_accounts')
        .where('actorId', '=', params.actorId)
        .execute()
      const now = new Date()
      await trx
        .insertInto('bluesky_accounts')
        .values({ ...params, createdAt: now, updatedAt: now })
        .execute()
      return 'saved' as const
    })
  } catch (error) {
    // A concurrent link of the same DID by another actor won the insert.
    if (isUniqueConstraintError(error)) return 'did_taken'
    throw error
  }
}

export const updateBlueskyAccountIdentity = async (
  db: Db,
  {
    actorId,
    handle,
    pdsUrl,
    domainHandle
  }: { actorId: string; handle: string; pdsUrl: string; domainHandle: boolean }
): Promise<void> => {
  await db
    .updateTable('bluesky_accounts')
    .set({ handle, pdsUrl, domainHandle, updatedAt: new Date() })
    .where('actorId', '=', actorId)
    .execute()
}

export const setBlueskyInstanceHandle = async (
  db: Db,
  { actorId, host }: { actorId: string; host: string | null }
): Promise<boolean> => {
  try {
    await db
      .updateTable('bluesky_accounts')
      .set({
        instanceHandle: host?.toLowerCase() ?? null,
        updatedAt: new Date()
      })
      .where('actorId', '=', actorId)
      .execute()
    return true
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

export const deleteBlueskyAccount = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<void> => {
  await inTransaction(db, async (trx) => {
    const row = await trx
      .selectFrom('bluesky_accounts')
      .select('did')
      .where('actorId', '=', actorId)
      .executeTakeFirst()
    if (!row) return
    await trx
      .deleteFrom('bluesky_sessions')
      .where('did', '=', row.did)
      .execute()
    await trx
      .deleteFrom('bluesky_accounts')
      .where('actorId', '=', actorId)
      .execute()
  })
}

export const getBlueskySession = async (
  db: Db,
  { did }: { did: string }
): Promise<string | null> => {
  const row = await db
    .selectFrom('bluesky_sessions')
    .select('session')
    .where('did', '=', did)
    .executeTakeFirst()
  return row?.session ?? null
}

export const setBlueskySession = async (
  db: Db,
  { did, session }: { did: string; session: string }
): Promise<void> => {
  const updatedAt = new Date()
  await db
    .insertInto('bluesky_sessions')
    .values({ did, session, updatedAt })
    .onConflict((oc) => oc.column('did').doUpdateSet({ session, updatedAt }))
    .execute()
}

export const deleteBlueskySession = async (
  db: Db,
  { did }: { did: string }
): Promise<void> => {
  await db.deleteFrom('bluesky_sessions').where('did', '=', did).execute()
}

export const getBlueskyOAuthState = async (
  db: Db,
  { key, now = Date.now() }: { key: string; now?: number }
): Promise<string | null> => {
  const row = await db
    .selectFrom('bluesky_oauth_states')
    .select(['state', 'expiresAt'])
    .where('key', '=', key)
    .executeTakeFirst()
  if (!row) return null
  // Compared after parsing so SQLite's mixed timestamp storage cannot return
  // an expired state.
  return getCompatibleTime(row.expiresAt) > now ? row.state : null
}

export const setBlueskyOAuthState = async (
  db: Db,
  {
    key,
    state,
    expiresAt,
    now = Date.now()
  }: { key: string; state: string; expiresAt: number; now?: number }
): Promise<void> => {
  await db
    .deleteFrom('bluesky_oauth_states')
    .where('expiresAt', '<=', timestampValue(now))
    .execute()
  await db
    .insertInto('bluesky_oauth_states')
    .values({ key, state, expiresAt: new Date(expiresAt) })
    .onConflict((oc) =>
      oc.column('key').doUpdateSet({ state, expiresAt: new Date(expiresAt) })
    )
    .execute()
}

export const deleteBlueskyOAuthState = async (
  db: Db,
  { key }: { key: string }
): Promise<void> => {
  await db.deleteFrom('bluesky_oauth_states').where('key', '=', key).execute()
}

export const blueskyAccountQueries = {
  getBlueskyAccount,
  getBlueskyAccountByDid,
  getBlueskyAccountByInstanceHandle,
  saveBlueskyAccount,
  updateBlueskyAccountIdentity,
  setBlueskyInstanceHandle,
  deleteBlueskyAccount,
  getBlueskySession,
  setBlueskySession,
  deleteBlueskySession,
  getBlueskyOAuthState,
  setBlueskyOAuthState,
  deleteBlueskyOAuthState
}
