import { dash } from '@better-auth/infra'
import { oauthProvider } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import bcrypt from 'bcrypt'
import { betterAuth } from 'better-auth'
import { jwt, twoFactor } from 'better-auth/plugins'

import { getBaseURL, getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { UsableScopes } from '@/lib/types/database/operations'
import { logger } from '@/lib/utils/logger'

import { knexAdapter } from './knexAdapter'
import { buildTrustedOrigins } from './trustedOrigins'

export const AUTH_COOKIE_PREFIX = 'better-auth'
export const AUTH_SESSION_COOKIE_NAME = 'session_token'

const buildAuth = (baseURL: string) => {
  const config = getConfig()
  const database = getDatabase()
  const db = getKnex()

  const rpID = new URL(baseURL).hostname

  return betterAuth({
    logger: {
      level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn'
    },
    appName: 'activities-next',
    secret: config.secretPhase,
    baseURL,
    // Trust the configured host plus any ACTIVITIES_TRUSTED_HOSTS so a Mastodon
    // client logging into a served alias/custom domain isn't rejected with
    // `403 Invalid origin` on credential sign-in. The union is the same for
    // every per-host instance (it already contains this instance's origin) so a
    // request handled by any instance can sign in from any served domain.
    trustedOrigins: buildTrustedOrigins(
      getBaseURL(),
      config.trustedHosts ?? []
    ),
    basePath: '/api/auth',
    database: knexAdapter(db, { passkeyRpID: rpID }),
    disabledPaths: ['/token'], // Disable jwt plugin's /api/auth/token;
    // OAuth tokens are issued via oauthProvider. JWKS stays enabled for OAuthGuard.
    plugins: [
      // Sign the JWKS key (and therefore the OIDC id_tokens the oauthProvider
      // signs via this plugin) with RS256 so the published JWKS matches the
      // `id_token_signing_alg_values_supported: ['RS256']` advertised in the
      // OpenID discovery document. Without this the plugin defaults to
      // EdDSA/Ed25519 and a strict RS256 relying party (e.g. mozilla-django-oidc
      // with OIDC_RP_SIGN_ALGO=RS256) cannot verify the id_token signature.
      //
      // Rollout note: this `jwks` table has no per-key `alg` column (and the
      // plugin's jwks schema declares none), so better-auth resolves the signing
      // and JWKS `alg` from THIS config, not from each stored key. A fresh
      // deployment generates an RSA key on the first sign / first /api/auth/jwks
      // request and is consistent. A deployment that already signed a token (an
      // Ed25519 key already sits in `jwks`) must have that row cleared once on
      // rollout so a fresh RSA key is generated — otherwise the plugin loads the
      // stale Ed25519 key and tries to sign it as RS256, which throws. This does
      // not affect Mastodon OAuth2 clients: they use opaque access tokens
      // verified against the database (not the JWKS), and id_tokens are
      // short-lived, so no long-lived token depends on the retired EdDSA key.
      jwt({ jwks: { keyPairConfig: { alg: 'RS256', modulusLength: 2048 } } }),
      // rpID/origin are derived from this instance's resolved host so passkey
      // ceremonies run against the domain the request actually arrived on. See
      // `getAuth` and `resolveAuthBaseURL` for how the host is chosen per request.
      passkey({
        rpID,
        rpName: config.serviceName ?? 'Activities.next',
        origin: new URL(baseURL).origin
      }),
      twoFactor({
        issuer: config.serviceName ?? 'Activities.next',
        allowPasswordless: false
      }),
      oauthProvider({
        loginPage: '/auth/signin',
        consentPage: '/oauth/authorize',
        // Derived from the single scope vocabulary so the authorize endpoint
        // accepts exactly the scopes registration validates and metadata
        // advertises. better-auth rejects any requested scope not in this list.
        scopes: [...UsableScopes],
        accessTokenExpiresIn: 7 * 24 * 60 * 60,
        refreshTokenExpiresIn: 30 * 24 * 60 * 60,
        codeExpiresIn: 10 * 60,
        grantTypes: [
          'authorization_code',
          'client_credentials',
          'refresh_token'
        ],
        allowDynamicClientRegistration: false,
        postLogin: {
          page: '/oauth/authorize',
          // Consent is handled at /oauth/authorize; no additional redirect needed
          shouldRedirect: async () => false,
          consentReferenceId: async ({ session }) => {
            const actorId = (session as Record<string, unknown>)?.actorId as
              | string
              | undefined
            if (actorId) return actorId
            if (!database || !session?.userId) return undefined
            try {
              const account = await database.getAccountFromId({
                id: session.userId as string
              })
              return account?.defaultActorId ?? undefined
            } catch (e) {
              logger.error({
                message: 'Failed to load account in consentReferenceId',
                error: e
              })
              return undefined
            }
          }
        },
        customAccessTokenClaims: async ({ referenceId }) => {
          return { actorId: referenceId ?? null }
        },
        customIdTokenClaims: async ({ user }) => {
          return {
            email: user?.email ?? null,
            email_verified: user?.emailVerified ?? false
          }
        }
      }),
      dash()
    ],
    emailAndPassword: {
      enabled: config.auth?.enableCredential !== false,
      disableSignUp: true,
      requireEmailVerification: true,
      password: {
        hash: (password: string) => bcrypt.hash(password, 10),
        verify: ({ hash, password }: { hash: string; password: string }) =>
          bcrypt.compare(password, hash)
      }
    },
    account: {
      modelName: 'account_providers',
      accountLinking: {
        enabled: true
      },
      fields: {
        userId: 'accountId',
        providerId: 'provider',
        accountId: 'providerId'
      }
    },
    user: {
      modelName: 'accounts',
      fields: {
        email: 'email',
        emailVerified: 'emailVerified',
        name: 'name',
        image: 'image'
      }
    },
    session: {
      storeSessionInDatabase: true,
      modelName: 'sessions',
      fields: {
        userId: 'accountId',
        token: 'token',
        expiresAt: 'expireAt'
      },
      additionalFields: {
        actorId: {
          type: 'string',
          required: false
        }
      }
    },
    pages: {
      signIn: '/auth/signin'
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            if (!database) return
            let account
            try {
              account = await database.getAccountFromId({ id: session.userId })
            } catch (e) {
              logger.error({
                message: 'Failed to load account in session hook',
                error: e
              })
              return false
            }
            if (!account) return false
            if (!account.verifiedAt) return false
            return {
              data: {
                ...session,
                actorId: account?.defaultActorId || null
              }
            }
          }
        }
      }
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['x-forwarded-for', 'x-real-ip']
      }
    }
  })
}

// Cache one better-auth instance per resolved base URL. Instances differ only in
// their passkey rpID/origin; everything else (database, secret, trusted-origin
// union) is shared, so they all read/write the same sessions and accounts.
//
// The cache is LRU-bounded: with a concrete ACTIVITIES_TRUSTED_HOSTS list the key
// set is small, but a wildcard entry (e.g. `*.example.com`) lets
// `resolveAuthBaseURL` yield a different concrete subdomain per request — and the
// host is request-influenced — so an unbounded map would be a memory-exhaustion
// vector. Capping with oldest-entry eviction keeps it bounded while still serving
// every legitimately-used domain.
const MAX_AUTH_INSTANCES = 32
const authInstances = new Map<string, ReturnType<typeof buildAuth>>()

// Get the auth instance for a base URL, defaulting to the configured host. Pass
// a per-request base URL (from `resolveAuthBaseURL`) for passkey ceremonies so
// they use the domain the request arrived on; callers that only need session or
// OAuth handling can omit it and use the configured host.
export const getAuth = (baseURL: string = getBaseURL()) => {
  const cached = authInstances.get(baseURL)
  if (cached) {
    // Refresh recency so the most-used domains survive eviction.
    authInstances.delete(baseURL)
    authInstances.set(baseURL, cached)
    return cached
  }

  if (authInstances.size >= MAX_AUTH_INSTANCES) {
    const oldest = authInstances.keys().next().value
    if (oldest !== undefined) authInstances.delete(oldest)
  }

  const instance = buildAuth(baseURL)
  authInstances.set(baseURL, instance)
  return instance
}
