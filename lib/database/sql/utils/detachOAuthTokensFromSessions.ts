import { Knex } from 'knex'

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
  if (sessionIds.length === 0) return
  await trx('oauthAccessToken')
    .whereIn('sessionId', sessionIds)
    .update({ sessionId: null })
  await trx('oauthRefreshToken')
    .whereIn('sessionId', sessionIds)
    .update({ sessionId: null })
}
