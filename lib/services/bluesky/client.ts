import { createIdentityResolver } from '@atproto-labs/identity-resolver'
import {
  AtprotoHandleResolverNode,
  JoseKey,
  NodeOAuthClient,
  type NodeSavedSession,
  type NodeSavedSessionStore,
  type NodeSavedStateStore,
  type RuntimeLock
} from '@atproto/oauth-client-node'
import crypto from 'node:crypto'

import { type Config, getBaseURL, getConfig } from '@/lib/config'
import type { Database } from '@/lib/database/types'
import { decrypt, encrypt } from '@/lib/utils/crypto'

import { blueskyFetch } from './fetch'

// `transition:generic` covers the posts, likes, reposts and follows the later
// client steps write; every PDS with OAuth accepts it.
export const BLUESKY_OAUTH_SCOPE = 'atproto transition:generic'

const STATE_TTL_MS = 60 * 60 * 1000
const LOCK_TTL_MS = 60 * 1000
const LOCK_WAIT_MS = 30 * 1000
const LOCK_POLL_MS = 200

export const getBlueskyOAuthUrls = () => {
  const base = getBaseURL()
  return {
    clientId: `${base}/api/v1/bluesky/client-metadata.json`,
    jwksUri: `${base}/api/v1/bluesky/jwks.json`,
    redirectUri: `${base}/api/v1/bluesky/callback`
  }
}

export const createBlueskyIdentityResolver = () =>
  createIdentityResolver({
    fetch: blueskyFetch,
    handleResolver: new AtprotoHandleResolverNode({ fetch: blueskyFetch })
  })

// What `bluesky_sessions` holds for a DID, encrypted with the server secret.
// The tag keeps an app-password session from ever being read as an OAuth one.
export type StoredBlueskySession =
  | { type: 'oauth'; session: NodeSavedSession }
  | { type: 'app_password'; accessJwt: string; refreshJwt: string }

export const readStoredBlueskySession = async (
  database: Database,
  did: string
): Promise<StoredBlueskySession | null> => {
  const value = await database.getBlueskySession({ did })
  return value ? (JSON.parse(decrypt(value)) as StoredBlueskySession) : null
}

export const writeStoredBlueskySession = (
  database: Database,
  did: string,
  session: StoredBlueskySession
) =>
  database.setBlueskySession({
    did,
    session: encrypt(JSON.stringify(session))
  })

const createStateStore = (database: Database): NodeSavedStateStore => ({
  get: async (key) => {
    const value = await database.getBlueskyOAuthState({ key })
    return value ? JSON.parse(decrypt(value)) : undefined
  },
  set: (key, state) =>
    database.setBlueskyOAuthState({
      key,
      state: encrypt(JSON.stringify(state)),
      expiresAt: Date.now() + STATE_TTL_MS
    }),
  del: (key) => database.deleteBlueskyOAuthState({ key })
})

const createSessionStore = (database: Database): NodeSavedSessionStore => ({
  get: async (did) => {
    const stored = await readStoredBlueskySession(database, did)
    return stored?.type === 'oauth' ? stored.session : undefined
  },
  set: (did, session) =>
    writeStoredBlueskySession(database, did, { type: 'oauth', session }),
  del: (did) => database.deleteBlueskySession({ did })
})

// Refresh tokens are single use, so two processes refreshing one session at
// once would revoke it. The lock is a row in the shared lock table, so it
// holds across every instance of the server.
export const createBlueskyLock =
  (database: Database): RuntimeLock =>
  async (name, fn) => {
    const lockKey = `bluesky:${crypto.createHash('sha256').update(name).digest('hex')}`
    const deadline = Date.now() + LOCK_WAIT_MS
    for (;;) {
      const lock = await database.acquireImportLock({
        lockKey,
        ttlMs: LOCK_TTL_MS
      })
      if (lock) {
        try {
          return await fn()
        } finally {
          await database.releaseImportLock({ lockKey, token: lock.token })
        }
      }
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for the Bluesky session lock')
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS))
    }
  }

const buildClient = async (
  database: Database,
  config: Config & { bluesky: NonNullable<Config['bluesky']> }
) => {
  const keyset = await Promise.all(
    config.bluesky.oauthPrivateKeys.map((jwk) => JoseKey.fromJWK(jwk))
  )
  const { clientId, jwksUri, redirectUri } = getBlueskyOAuthUrls()
  return new NodeOAuthClient({
    clientMetadata: {
      client_id: clientId,
      client_name: config.serviceName || config.host,
      client_uri: getBaseURL(),
      redirect_uris: [redirectUri as `https://${string}`],
      scope: BLUESKY_OAUTH_SCOPE,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'web',
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_signing_alg: 'ES256',
      dpop_bound_access_tokens: true,
      jwks_uri: jwksUri as `https://${string}`
    },
    keyset,
    fetch: blueskyFetch,
    identityResolver: createBlueskyIdentityResolver(),
    stateStore: createStateStore(database),
    sessionStore: createSessionStore(database),
    requestLock: createBlueskyLock(database)
  })
}

let cached:
  | { database: Database; config: Config; client: Promise<NodeOAuthClient> }
  | undefined

/** null when no OAuth keys are configured (app passwords still work). */
export const getBlueskyOAuthClient = (
  database: Database
): Promise<NodeOAuthClient> | null => {
  const config = getConfig()
  const bluesky = config.bluesky
  if (!bluesky) return null
  if (cached?.database !== database || cached.config !== config) {
    const client = buildClient(database, { ...config, bluesky })
    // A bad key must not stay cached as a rejected promise.
    client.catch(() => {
      if (cached?.client === client) cached = undefined
    })
    cached = { database, config, client }
  }
  return cached.client
}
