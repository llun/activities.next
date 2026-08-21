import { dash, sentinel } from '@better-auth/infra'
import { oauthProvider } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import bcrypt from 'bcrypt'
import { betterAuth } from 'better-auth'
import { jwt, twoFactor } from 'better-auth/plugins'

import { getBaseURL, getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { UsableScopes } from '@/lib/types/database/operations'
import { logger } from '@/lib/utils/logger'

import { canCreateSessionForAccount } from './canCreateSessionForAccount'
import { ConsentSession, resolveConsentReferenceId } from './consentReferenceId'
import { AUTH_BASE_PATH, AUTH_ERROR_PATH } from './constants'
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
    // Resolve a session and its account in ONE statement instead of two. Without
    // this better-auth reads the `sessions` row, then reads the `accounts` row
    // it points at, on every authenticated request.
    //
    // The flag lived at `experimental.joins` until better-auth 1.7 moved it
    // here; 1.7 dropped `experimental` entirely, so the old key is silently
    // ignored rather than rejected — which is exactly the shape of a
    // "performance regression nobody notices". `sessionJoins.test.ts` asserts
    // the single statement, so the flag going stale again fails a test.
    //
    // 1.7 also made the flag a request rather than an assertion: the factory now
    // falls back to separate queries for an adapter that leaves `join`
    // unanswered, where 1.6.x read the related rows straight off whatever came
    // back and logged every user out if they were missing. `knexAdapter`
    // implements the join contract either way (see the join helpers there).
    advanced: {
      database: {
        joins: true
      },
      ipAddress: {
        ipAddressHeaders: ['x-forwarded-for', 'x-real-ip']
      }
    },
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
    basePath: AUTH_BASE_PATH,
    // Send failed auth/OAuth requests to our own page instead of better-auth's
    // built-in /api/auth/error, which is a development affordance: in
    // production it does not render at all, it 302s to `/?error=...&
    // error_description=...`, so a Mastodon client presenting a client_id this
    // server no longer knows just lands on the home timeline and its sign-in
    // looks like it silently did nothing.
    //
    // Every authorize-time rejection @better-auth/oauth-provider raises routes
    // through here: invalid_client, client_disabled, unauthorized_client,
    // invalid_redirect, invalid_request, invalid_request_uri,
    // unsupported_response_type, unsupported_prompt_select_account. Core's
    // INVALID_TOKEN can too, but only in the narrow case errorPage.ts describes
    // — its reset endpoint sends both failing branches to the client's
    // callbackURL unless that is empty, and this instance runs its own reset
    // flow regardless. `access_denied` and
    // `invalid_scope` deliberately do not: both are reported to the client's
    // redirect_uri (`formatErrorURL(query.redirect_uri, …)`, with no
    // `getErrorURL` call site for either), per RFC 6749 §4.1.2.1. They are still
    // mapped in errorPage.ts for a client that hands the code back to us.
    //
    // Note this cannot be paired with `onAPIError.onError` for correlation:
    // better-auth's router skips onError for anything it redirects
    // (`if (isAPIError(e) && e.status === 'FOUND') return`), which is exactly
    // this class of failure, and setting onError at all suppresses better-auth's
    // own built-in logging. The error page logs what it renders instead.
    onAPIError: {
      errorURL: AUTH_ERROR_PATH
    },
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
      // Rollout note: better-auth 1.7 added a per-key `alg` column to `jwks`
      // (and `crv`), so from here on a key records the algorithm it was minted
      // for and the plugin can resolve a signing key by it. Rows written before
      // that migration have a NULL `alg` and still fall back to THIS config.
      // Which means the pre-1.7 hazard stands for them: a deployment that
      // already signed a token with the pre-RS256 default (an Ed25519 key sits
      // in `jwks`) must have that row cleared once on rollout, or the plugin
      // loads the stale Ed25519 key and tries to sign it as RS256, which throws.
      // A fresh deployment generates an RSA key on the first sign / first
      // /api/auth/jwks request and is consistent. Either way this does not
      // affect Mastodon OAuth2 clients: they use opaque access tokens verified
      // against the database (not the JWKS), and id_tokens are short-lived, so
      // no long-lived token depends on the retired EdDSA key.
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
          consentReferenceId: async ({ session }) =>
            resolveConsentReferenceId({
              database,
              session: session as ConsentSession | undefined
            })
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
      dash(),
      sentinel()
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
            // Email-verified, not disabled, and approved (see the helper).
            if (!canCreateSessionForAccount(account)) return false
            return {
              data: {
                ...session,
                actorId: account?.defaultActorId || null
              }
            }
          }
        }
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
