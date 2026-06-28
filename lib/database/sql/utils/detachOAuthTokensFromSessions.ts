import { Knex } from 'knex'

// Cap each `whereIn` list well under the smallest backend bind-parameter ceiling
// (SQLite's historical 999) so a large bulk session cleanup — e.g. expired
// sessions across every account flowing through the better-auth adapter — can't
// blow the limit and crash. PostgreSQL's ceiling (65535) is far higher, so one
// conservative size is safe for every backend.
export const SESSION_ID_CHUNK_SIZE = 500

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

/**
 * `oauthAccessToken.sessionId` and `oauthRefreshToken.sessionId` are foreign
 * keys into `sessions.id` with no `ON DELETE` action, so PostgreSQL — which,
 * unlike the SQLite backend the test suite runs on, actually enforces foreign
 * keys — rejects deleting a session that minted OAuth tokens with error 23503.
 *
 * Detaching those tokens (clearing the session link) before the session row is
 * removed lets the session be revoked while the connected app keeps working:
 * bearer-token validation never reads `sessionId` (see `OAuthGuard`), and the
 * app is still revoked on its own through `revokeAccountConnectedApp`. Call this
 * inside the same transaction as the session delete so a partial failure can't
 * leave tokens detached from a session that still exists.
 */
export const detachOAuthTokensFromSessions = async (
  trx: Knex.Transaction,
  sessionIds: string[]
): Promise<void> => {
  for (const batch of chunk(sessionIds, SESSION_ID_CHUNK_SIZE)) {
    await trx('oauthAccessToken')
      .whereIn('sessionId', batch)
      .update({ sessionId: null })
    await trx('oauthRefreshToken')
      .whereIn('sessionId', batch)
      .update({ sessionId: null })
  }
}

/**
 * FK-safe session delete. Resolves the session ids matched by `scope`, detaches
 * their OAuth tokens, then deletes exactly those rows (by primary key). Every
 * code path that removes `sessions` rows must go through here so none can
 * reintroduce the `sessionId` FK violation — deleting by the resolved ids also
 * means a session a concurrent insert added between the lookup and the delete
 * can't be deleted undetached. Must run inside a transaction; returns the number
 * of sessions deleted. `filter(Boolean)` guards against a stray empty id, and
 * the delete is chunked to stay under backend bind-parameter limits.
 */
export const deleteSessionsWithTokenDetach = async (
  trx: Knex.Transaction,
  scope: (query: Knex.QueryBuilder) => Knex.QueryBuilder
): Promise<number> => {
  const rows = await scope(trx('sessions')).select<{ id: string }[]>(
    'sessions.id'
  )
  const ids = rows.map((row) => row.id).filter(Boolean)
  if (ids.length === 0) return 0
  await detachOAuthTokensFromSessions(trx, ids)
  let deletedCount = 0
  for (const batch of chunk(ids, SESSION_ID_CHUNK_SIZE)) {
    deletedCount += await trx('sessions').whereIn('id', batch).delete()
  }
  return deletedCount
}
