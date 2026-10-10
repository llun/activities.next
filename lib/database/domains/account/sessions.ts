import type { Expression, ExpressionBuilder, SqlBool } from 'kysely'

import type {
  CreateAccountSessionParams,
  DeleteAccountSessionByIdParams,
  DeleteOtherAccountSessionsParams,
  GetAccountAllSessionsParams
} from '@/lib/database/domains/account/types'
import { recordWeeklyLoginSafely } from '@/lib/database/domains/instanceActivity/queries'
import { type DB, type Db, inTransaction } from '@/lib/database/kysely'
import { chunkArray } from '@/lib/database/sql/utils/knex'
import { Session } from '@/lib/types/domain/session'

// Cap each `in (…)` list well under the smallest backend bind-parameter ceiling
// (SQLite's historical 999) so a large bulk session cleanup can't blow the
// limit. PostgreSQL's ceiling (65535) is far higher, so one conservative size
// is safe for every backend. The Knex helpers in
// lib/database/sql/utils/detachOAuthTokensFromSessions.ts use the same size.
export const SESSION_ID_CHUNK_SIZE = 500

/**
 * Kysely counterpart of `detachOAuthTokensFromSessions` in
 * lib/database/sql/utils/detachOAuthTokensFromSessions.ts, which the better-auth
 * adapter (still on Knex) keeps using; both write the same rows.
 *
 * `oauthAccessToken.sessionId` and `oauthRefreshToken.sessionId` are foreign
 * keys into `sessions.id` with no `ON DELETE` action, so PostgreSQL rejects
 * deleting a session that minted OAuth tokens (23503). Clearing the link first
 * lets the session be revoked while the connected app keeps working: bearer
 * token validation never reads `sessionId` (see `OAuthGuard`), and the app is
 * revoked on its own through `revokeAccountConnectedApp`. Run it in the same
 * transaction as the session delete.
 */
export const detachOAuthTokensFromSessions = async (
  db: Db,
  sessionIds: string[]
): Promise<void> => {
  for (const batch of chunkArray(sessionIds, SESSION_ID_CHUNK_SIZE)) {
    await db
      .updateTable('oauthAccessToken')
      .set({ sessionId: null })
      .where('sessionId', 'in', batch)
      .execute()
    await db
      .updateTable('oauthRefreshToken')
      .set({ sessionId: null })
      .where('sessionId', 'in', batch)
      .execute()
  }
}

/**
 * FK-safe session delete, the Kysely counterpart of the Knex
 * `deleteSessionsWithTokenDetach`. Resolves the ids of the sessions `scope`
 * matches, detaches their OAuth tokens, then deletes exactly those rows by
 * primary key, all in one transaction (the caller's when `db` is one). Deleting
 * by the resolved ids means a session a concurrent insert added between the
 * lookup and the delete can't be deleted undetached. Returns the number of
 * sessions deleted.
 */
export const deleteSessionsWithTokenDetach = (
  db: Db,
  scope: (eb: ExpressionBuilder<DB, 'sessions'>) => Expression<SqlBool>
): Promise<number> =>
  inTransaction(db, async (trx) => {
    const rows = await trx
      .selectFrom('sessions')
      .select('id')
      .where(scope)
      .execute()
    const ids = rows.map((row) => row.id).filter(Boolean)
    if (ids.length === 0) return 0
    await detachOAuthTokensFromSessions(trx, ids)
    let deletedCount = 0
    for (const batch of chunkArray(ids, SESSION_ID_CHUNK_SIZE)) {
      const result = await trx
        .deleteFrom('sessions')
        .where('id', 'in', batch)
        .executeTakeFirst()
      deletedCount += Number(result.numDeletedRows)
    }
    return deletedCount
  })

export const createAccountSession = async (
  db: Db,
  { accountId, expireAt, token, actorId }: CreateAccountSessionParams
): Promise<void> => {
  const currentTime = new Date()

  await db
    .insertInto('sessions')
    .values({
      id: crypto.randomUUID(),
      accountId,
      token,
      actorId: actorId ?? null,
      expireAt: new Date(expireAt),
      createdAt: currentTime,
      updatedAt: currentTime
    })
    .execute()
  await recordWeeklyLoginSafely(db, accountId, currentTime)
}

export const getAccountAllSessions = async (
  db: Db,
  { accountId }: GetAccountAllSessionsParams
): Promise<Session[]> => {
  const sessions = await db
    .selectFrom('sessions')
    .selectAll()
    .where('accountId', '=', accountId)
    .execute()
  return sessions.map((session) =>
    Session.parse({ ...session, actorId: session.actorId ?? null })
  )
}

export const deleteAccountSessionById = (
  db: Db,
  { accountId, id }: DeleteAccountSessionByIdParams
): Promise<number> =>
  // Ownership is a predicate on the delete itself, so the check and the write
  // resolve the same row.
  deleteSessionsWithTokenDetach(db, (eb) =>
    eb.and([eb('id', '=', id), eb('accountId', '=', accountId)])
  )

export const deleteOtherAccountSessions = (
  db: Db,
  { accountId, exceptToken }: DeleteOtherAccountSessionsParams
): Promise<number> =>
  deleteSessionsWithTokenDetach(db, (eb) =>
    eb.and([
      eb('accountId', '=', accountId),
      eb.not(eb('token', '=', exceptToken))
    ])
  )
