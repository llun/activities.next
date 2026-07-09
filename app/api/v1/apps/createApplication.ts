// SafeUrlSchema is a PUBLIC export of @better-auth/core (its `exports` map
// declares `./utils/*`, and the schema's own doc-comment sanctions external
// consumption). @better-auth/core is a direct, exact-pinned (1.6.20) dependency,
// so this resolves under strict package managers (this repo uses Yarn 4) and
// can't drift on a minor/patch bump. We deliberately reuse it rather than
// re-implement the policy: the end-session endpoint validates the incoming
// `post_logout_redirect_uri` with this exact same schema, so reusing it keeps
// registration-time and logout-time validation byte-for-byte aligned (a local
// copy would silently drift on any future better-auth change).
import { SafeUrlSchema } from '@better-auth/core/utils/redirect-uri'
import crypto from 'crypto'
import type { Knex } from 'knex'

import { getKnex } from '@/lib/database'
import { Scope } from '@/lib/types/database/operations'
import { logger } from '@/lib/utils/logger'
import { getTracer } from '@/lib/utils/trace'

import type {
  ErrorResponse,
  PostRequest,
  PostResponse,
  SuccessResponse
} from './types'

const hashClientSecret = (secret: string): string => {
  const hash = crypto.createHash('sha256').update(secret).digest()
  return hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const generateRandomString = (length: number): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const limit = 256 - (256 % chars.length)
  let result = ''
  while (result.length < length) {
    const bytes = crypto.randomBytes(length * 2)
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      if (bytes[i] < limit) {
        result += chars[bytes[i] % chars.length]
      }
    }
  }
  return result
}

const validationErrorResponse = (): ErrorResponse => ({
  type: 'error',
  error: 'Failed to validate request'
})

const rateLimitErrorResponse = (): ErrorResponse => ({
  type: 'error',
  error: 'Too many application registrations'
})

type CreateApplicationOptions = {
  registrationKey?: string
  now?: Date
}

const APP_REGISTRATION_REFERENCE_PREFIX = 'app-registration:'
const APP_REGISTRATION_LIMIT = 5
const APP_REGISTRATION_WINDOW_MS = 10 * 60 * 1000
const APP_REGISTRATION_GC_AFTER_MS = 24 * 60 * 60 * 1000
const APP_REGISTRATION_GC_INTERVAL_MS = 60 * 60 * 1000
const APP_REGISTRATION_GC_BATCH_SIZE = 1000
const REGISTERED_UNAUTHENTICATED_METADATA = JSON.stringify({
  registeredUnauthenticated: true
})

let lastAppRegistrationGcAt: number | null = null

export const resetAppRegistrationGcStateForTests = () => {
  lastAppRegistrationGcAt = null
}

const getRegistrationReference = (registrationKey?: string): string | null => {
  if (!registrationKey) return null
  return `${APP_REGISTRATION_REFERENCE_PREFIX}${registrationKey}`
}

const whereUnauthenticatedAppRegistration = (
  query: Knex.QueryBuilder
): void => {
  query.where(
    'oauthClient.referenceId',
    'like',
    `${APP_REGISTRATION_REFERENCE_PREFIX}%`
  )
  query.orWhere((anonymousQuery) => {
    anonymousQuery
      .where('oauthClient.referenceId', '')
      .where('oauthClient.metadata', REGISTERED_UNAUTHENTICATED_METADATA)
  })
}

const garbageCollectStaleAppRegistrations = async (db: Knex, now: Date) => {
  const staleBefore = new Date(now.getTime() - APP_REGISTRATION_GC_AFTER_MS)
  const staleClientIds = await db('oauthClient')
    .leftJoin(
      'oauthAccessToken',
      'oauthAccessToken.clientId',
      'oauthClient.clientId'
    )
    .leftJoin(
      'oauthRefreshToken',
      'oauthRefreshToken.clientId',
      'oauthClient.clientId'
    )
    .leftJoin('oauthConsent', 'oauthConsent.clientId', 'oauthClient.clientId')
    .where(whereUnauthenticatedAppRegistration)
    .where('oauthClient.createdAt', '<', staleBefore)
    .whereNull('oauthAccessToken.id')
    .whereNull('oauthRefreshToken.id')
    .whereNull('oauthConsent.id')
    .orderBy('oauthClient.createdAt', 'asc')
    .limit(APP_REGISTRATION_GC_BATCH_SIZE)
    .pluck('oauthClient.clientId')

  if (staleClientIds.length > 0) {
    await db('oauthClient').whereIn('clientId', staleClientIds).delete()
  }
}

const isAppRegistrationRateLimited = async ({
  db,
  now,
  registrationReference
}: {
  db: Knex
  now: Date
  registrationReference: string | null
}): Promise<boolean> => {
  if (!registrationReference) return false

  const windowStart = new Date(now.getTime() - APP_REGISTRATION_WINDOW_MS)
  const countResult = await db('oauthClient')
    .where('referenceId', registrationReference)
    .where('createdAt', '>=', windowStart)
    .count<{ count: number | string | bigint }[]>({ count: '*' })
    .first()

  return Number(countResult?.count ?? 0) >= APP_REGISTRATION_LIMIT
}

const shouldRunAppRegistrationGc = (now: Date): boolean => {
  const nowMs = now.getTime()
  if (
    lastAppRegistrationGcAt !== null &&
    nowMs >= lastAppRegistrationGcAt &&
    nowMs - lastAppRegistrationGcAt < APP_REGISTRATION_GC_INTERVAL_MS
  ) {
    return false
  }

  lastAppRegistrationGcAt = nowMs
  return true
}

const maybeGarbageCollectStaleAppRegistrations = async (
  db: Knex,
  now: Date
) => {
  if (!shouldRunAppRegistrationGc(now)) return

  try {
    await garbageCollectStaleAppRegistrations(db, now)
  } catch (error) {
    logger.warn({
      message: 'Stale app registration cleanup failed',
      error
    })
  }
}

export const createApplication = async (
  request: PostRequest,
  options: CreateApplicationOptions = {}
): Promise<PostResponse> => {
  return getTracer().startActiveSpan(
    'createApplication',
    { attributes: { clientName: request.client_name, scopes: request.scopes } },
    async (span) => {
      const scopes = request.scopes ?? Scope.enum.read
      const db = getKnex()

      try {
        const now = options.now ?? new Date()
        const registrationReference = getRegistrationReference(
          options.registrationKey
        )

        if (
          await isAppRegistrationRateLimited({
            db,
            now,
            registrationReference
          })
        ) {
          return rateLimitErrorResponse()
        }

        // The registration throttle is a best-effort guard: count + insert is
        // intentionally not a cross-database atomic hard cap. Cleanup is also
        // best effort and throttled so rejected floods do not trigger joins.
        await maybeGarbageCollectStaleAppRegistrations(db, now)

        // Always create a new client — per the Mastodon API spec, each POST
        // creates a new application with fresh credentials. Silent secret
        // rotation on re-registration would break existing configured clients.
        const clientId = generateRandomString(32)
        const clientSecret = generateRandomString(32)
        const hashedSecret = hashClientSecret(clientSecret)
        const scopeValues = (scopes.trim() || Scope.enum.read)
          .split(/\s+/)
          .filter(Boolean)
        if (scopeValues.length === 0) {
          return validationErrorResponse()
        }
        const parsedScopes: Scope[] = []
        for (const scope of scopeValues) {
          const parsed = Scope.safeParse(scope)
          if (!parsed.success) {
            return validationErrorResponse()
          }
          parsedScopes.push(parsed.data)
        }
        // Mastodon API: multiple redirect URIs arrive as a JSON array (4.3+)
        // or as a single newline-separated string (deprecated pre-4.3 form).
        const redirectUris = (
          Array.isArray(request.redirect_uris)
            ? request.redirect_uris
            : request.redirect_uris.split('\n')
        )
          .map((uri) => uri.trim())
          .filter(Boolean)
        if (redirectUris.length === 0) {
          return validationErrorResponse()
        }
        // RFC 8252 §7.1: native apps may use custom URI schemes (e.g. myapp://callback)
        // or http://localhost for loopback redirect.
        const unsafeSchemes = new Set(['javascript:', 'data:', 'vbscript:'])
        for (const uri of redirectUris) {
          try {
            const parsed = new URL(uri)
            if (unsafeSchemes.has(parsed.protocol)) {
              return validationErrorResponse()
            }
          } catch {
            return validationErrorResponse()
          }
        }
        // Optional OpenID Connect RP-Initiated Logout callbacks (newline-
        // separated, like redirect_uris). When at least one valid URI is
        // supplied, end-session is enabled for the client so it can drive single
        // logout; omitted ⇒ end-session stays disabled. Validate each URI with
        // the SAME SafeUrlSchema the end-session endpoint enforces on the
        // incoming post_logout_redirect_uri query param (rejects fragments and
        // non-HTTPS except loopback) so a stored URI can never pass registration
        // yet silently fail at logout time.
        const postLogoutRedirectUris = (request.post_logout_redirect_uris ?? '')
          .split('\n')
          .map((uri) => uri.trim())
          .filter(Boolean)
        for (const uri of postLogoutRedirectUris) {
          if (!SafeUrlSchema.safeParse(uri).success) {
            return validationErrorResponse()
          }
        }
        const enableEndSession = postLogoutRedirectUris.length > 0
        const dbId = crypto.randomUUID()
        await db('oauthClient').insert({
          id: dbId,
          clientId,
          clientSecret: hashedSecret,
          name: request.client_name,
          scopes: JSON.stringify(parsedScopes),
          redirectUris: JSON.stringify(redirectUris),
          // Stored as a JSON-array string to match `redirectUris`; better-auth's
          // adapter JSON-parses `string[]` fields back into arrays on read.
          postLogoutRedirectUris: enableEndSession
            ? JSON.stringify(postLogoutRedirectUris)
            : null,
          enableEndSession,
          uri: request.website || null,
          // Mastodon /api/v1/apps has no PKCE-capability field; PKCE is opt-in
          // at authorize-time via code_challenge. better-auth still enforces it
          // when present, and for public clients regardless of this flag.
          requirePKCE: false,
          disabled: false,
          grantTypes: JSON.stringify([
            'authorization_code',
            'client_credentials',
            'refresh_token'
          ]),
          responseTypes: JSON.stringify(['code']),
          tokenEndpointAuthMethod: 'client_secret_post',
          referenceId: registrationReference ?? '',
          metadata: REGISTERED_UNAUTHENTICATED_METADATA,
          createdAt: now,
          updatedAt: now
        })

        const response: SuccessResponse = {
          type: 'success',
          id: dbId,
          client_id: clientId,
          client_secret: clientSecret,
          name: request.client_name,
          website: request.website,
          redirect_uri: redirectUris[0]
        }
        return response
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        return validationErrorResponse()
      } finally {
        span.end()
      }
    }
  )
}
