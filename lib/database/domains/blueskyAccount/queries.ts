import { type Selectable, sql } from 'kysely'

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
  lastSyncedAt: row.lastSyncedAt ? getCompatibleTime(row.lastSyncedAt) : null,
  syncError: row.syncError ?? null,
  notificationsSeenAt: row.notificationsSeenAt
    ? getCompatibleTime(row.notificationsSeenAt)
    : null,
  crosspostByDefault: Boolean(row.crosspostByDefault),
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

// Actors who may hold the claim on `host` now: on that domain (an actor can
// move to another), with an admin account, neither disabled nor suspended. A
// claim whose holder lost any of that answers nothing and can be taken.
const eligibleClaimHolderIds = (db: Db, host: string) =>
  db
    .selectFrom('actors')
    .innerJoin('accounts', 'accounts.id', 'actors.accountId')
    .select('actors.id')
    // Rows written before domains were normalized may keep their spelling.
    .where(sql`lower(${sql.ref('actors.domain')})`, '=', host)
    .where('accounts.role', '=', 'admin')
    .where('accounts.disabledAt', 'is', null)
    .where('actors.suspendedAt', 'is', null)

// Whether `actorId` is an eligible holder of `host` now (above). A hosted
// Bluesky account on the bare domain answers for it only while this holds,
// the same rule as a linked account's claim.
export const isEligibleInstanceHandleHolder = async (
  db: Db,
  { actorId, host }: { actorId: string; host: string }
): Promise<boolean> =>
  Boolean(
    await eligibleClaimHolderIds(db, host.toLowerCase())
      .where('actors.id', '=', actorId)
      .executeTakeFirst()
  )

// Whether `actorId` may take `host` as its handle now: it is an eligible
// holder, and no other eligible holder's linked account claims it.
export const canHoldInstanceHandle = async (
  db: Db,
  { actorId, host }: { actorId: string; host: string }
): Promise<boolean> => {
  const normalized = host.toLowerCase()
  if (!(await isEligibleInstanceHandleHolder(db, { actorId, host }))) {
    return false
  }
  const other = await db
    .selectFrom('bluesky_accounts')
    .select('actorId')
    .where('instanceHandle', '=', normalized)
    .where('actorId', '!=', actorId)
    .where('actorId', 'in', eligibleClaimHolderIds(db, normalized))
    .executeTakeFirst()
  return !other
}

export const getBlueskyAccountByInstanceHandle = async (
  db: Db,
  { host }: { host: string }
): Promise<BlueskyAccount | null> => {
  const row = await db
    .selectFrom('bluesky_accounts')
    .selectAll()
    .where('instanceHandle', '=', host.toLowerCase())
    .where('actorId', 'in', eligibleClaimHolderIds(db, host.toLowerCase()))
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
      const now = new Date()
      // Linking the same DID again refreshes the row and keeps its claim,
      // creation time and last sync; an error from the old session is gone.
      if (previous?.did === params.did) {
        await trx
          .updateTable('bluesky_accounts')
          .set({ ...params, syncError: null, updatedAt: now })
          .where('actorId', '=', params.actorId)
          .execute()
        return 'saved' as const
      }
      if (previous) {
        await trx
          .deleteFrom('bluesky_sessions')
          .where('did', '=', previous.did)
          .execute()
        // Follow and interaction records in the old DID's repository.
        await trx
          .deleteFrom('bluesky_follows')
          .where('actorId', '=', params.actorId)
          .execute()
        await trx
          .deleteFrom('bluesky_interactions')
          .where('actorId', '=', params.actorId)
          .execute()
        await trx
          .deleteFrom('bluesky_accounts')
          .where('actorId', '=', params.actorId)
          .execute()
      }
      await trx
        .insertInto('bluesky_accounts')
        .values({ ...params, createdAt: now, updatedAt: now })
        .execute()
      return 'saved' as const
    })
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    // A concurrent insert won: another actor's link of the DID, or this
    // actor's own second submit of the same link.
    const winner = await db
      .selectFrom('bluesky_accounts')
      .select(['actorId', 'did'])
      .where('actorId', '=', params.actorId)
      .executeTakeFirst()
    return winner?.did === params.did ? 'saved' : 'did_taken'
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

export const updateBlueskyNotificationsSeenAt = async (
  db: Db,
  { actorId, seenAt }: { actorId: string; seenAt: number | null }
): Promise<void> => {
  await db
    .updateTable('bluesky_accounts')
    .set({
      notificationsSeenAt: seenAt === null ? null : new Date(seenAt)
    })
    .where('actorId', '=', actorId)
    .execute()
}

export const updateBlueskyCrosspostDefault = async (
  db: Db,
  {
    actorId,
    crosspostByDefault
  }: { actorId: string; crosspostByDefault: boolean }
): Promise<void> => {
  await db
    .updateTable('bluesky_accounts')
    .set({ crosspostByDefault, updatedAt: new Date() })
    .where('actorId', '=', actorId)
    .execute()
}

export const setBlueskyInstanceHandle = async (
  db: Db,
  { actorId, host }: { actorId: string; host: string | null }
): Promise<boolean> => {
  const instanceHandle = host?.toLowerCase() ?? null
  try {
    return await inTransaction(db, async (trx) => {
      if (instanceHandle) {
        // A hosted account on this server already answers for the host,
        // unless its holder is no longer eligible: then the claim may take it.
        const hosted = await trx
          .selectFrom('pds_repos')
          .select('did')
          .where('handle', '=', instanceHandle)
          .where('status', '!=', 'deleted')
          .where('actorId', 'in', eligibleClaimHolderIds(trx, instanceHandle))
          .executeTakeFirst()
        if (hosted) return false
        // Free a claim its holder can no longer make.
        await trx
          .updateTable('bluesky_accounts')
          .set({ instanceHandle: null, updatedAt: new Date() })
          .where('instanceHandle', '=', instanceHandle)
          .where(
            'actorId',
            'not in',
            eligibleClaimHolderIds(trx, instanceHandle)
          )
          .execute()
      }
      await trx
        .updateTable('bluesky_accounts')
        .set({ instanceHandle, updatedAt: new Date() })
        .where('actorId', '=', actorId)
        .execute()
      return true
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) return false
    throw error
  }
}

export const listBlueskyAccountsToSync = async (db: Db): Promise<string[]> => {
  const rows = await db
    .selectFrom('bluesky_accounts')
    .innerJoin(
      'bluesky_sessions',
      'bluesky_sessions.did',
      'bluesky_accounts.did'
    )
    .innerJoin('actors', 'actors.id', 'bluesky_accounts.actorId')
    .innerJoin('accounts', 'accounts.id', 'actors.accountId')
    .select('bluesky_accounts.actorId')
    // An actor that may not act (isActorModerationBlocked,
    // isActorConfirmationPending) or is being deleted is not synced.
    .where('actors.suspendedAt', 'is', null)
    .where('actors.deletionStatus', 'is', null)
    .where('accounts.disabledAt', 'is', null)
    .where((eb) =>
      eb.or([
        eb('accounts.verificationCode', 'is', null),
        eb('accounts.verificationCode', '=', ''),
        eb('accounts.emailVerified', '=', true)
      ])
    )
    .orderBy('bluesky_accounts.actorId')
    .execute()
  return rows.map((row) => row.actorId)
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
      .deleteFrom('bluesky_follows')
      .where('actorId', '=', actorId)
      .execute()
    await trx
      .deleteFrom('bluesky_interactions')
      .where('actorId', '=', actorId)
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
  isEligibleInstanceHandleHolder,
  canHoldInstanceHandle,
  saveBlueskyAccount,
  updateBlueskyAccountIdentity,
  updateBlueskyNotificationsSeenAt,
  updateBlueskyCrosspostDefault,
  setBlueskyInstanceHandle,
  listBlueskyAccountsToSync,
  deleteBlueskyAccount,
  getBlueskySession,
  setBlueskySession,
  deleteBlueskySession,
  getBlueskyOAuthState,
  setBlueskyOAuthState,
  deleteBlueskyOAuthState
}
