import crypto from 'crypto'

import { Database } from '@/lib/database/types'
import { hashToken } from '@/lib/services/guards/OAuthGuard'

// Matches `accessTokenExpiresIn` (7 days) in lib/services/auth/auth.ts so
// directly-issued tokens live as long as better-auth's authorization-code ones.
const ACCESS_TOKEN_EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000

export interface IssueAccessTokenParams {
  database: Database
  clientId: string
  // Owning account id.
  accountId: string
  // Actor delegated by the token; OAuthGuard resolves the request actor from it.
  actorId: string
  scopes: string[]
}

export interface IssuedAccessToken {
  // The raw bearer token to hand back to the client. Only its SHA-256 hash is
  // persisted (matching OAuthGuard's lookup), so this value is unrecoverable
  // once it leaves this function.
  token: string
  scopes: string[]
  // Epoch milliseconds.
  createdAt: number
}

// Mints an opaque OAuth access token bound to a newly registered account and
// persists only its hash, the same shape OAuthGuard validates for opaque
// tokens (DB existence + expiry + scopes + referenceId actor).
export const issueAccessToken = async ({
  database,
  clientId,
  accountId,
  actorId,
  scopes
}: IssueAccessTokenParams): Promise<IssuedAccessToken> => {
  const token = crypto.randomBytes(32).toString('base64url')
  const createdAt = Date.now()
  const expiresAt = createdAt + ACCESS_TOKEN_EXPIRES_IN_MS

  await database.createOAuthAccessToken({
    token: hashToken(token),
    clientId,
    accountId,
    actorId,
    scopes,
    expiresAt
  })

  return { token, scopes, createdAt }
}
