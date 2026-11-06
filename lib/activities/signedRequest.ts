import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { isActivityPubContentType } from '@/lib/activities/activityPubResponse'
import { DEFAULT_ACCEPT } from '@/lib/activities/constants'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import type { RemoteSignatureScheme } from '@/lib/database/domains/remoteSignatureScheme/types'
import type { Database } from '@/lib/database/types'
import { normalizeActorHost } from '@/lib/services/federation/domainRules'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { Actor } from '@/lib/types/domain/actor'
import { getHeaderValue } from '@/lib/utils/getHeaderValue'
import { signHttpMessage } from '@/lib/utils/httpMessageSignature'
import { logger } from '@/lib/utils/logger'
import { RequestOptions, RequestResult, request } from '@/lib/utils/request'
import { signedHeaders } from '@/lib/utils/signature'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export type SignatureScheme = RemoteSignatureScheme

export const REMEMBERED_SIGNATURE_SCHEME_MAX_HOSTS = 2048
// Short in-process cache TTL (positive and negative) so outbound hot paths do
// not query the database on every request while multi-worker deployments still
// converge within minutes.
export const SIGNATURE_SCHEME_CACHE_TTL_MS = 5 * 60 * 1000
export const REMEMBERED_SIGNATURE_SCHEME_TTL_MS = SIGNATURE_SCHEME_CACHE_TTL_MS
// Shared database TTL: HTTP signature support is tied to a remote server's
// software and rarely changes, double-knock self-heals immediately in either
// direction if a peer switches earlier, and 7 days lets cold starts and queue
// workers reuse learned schemes across days while expiring inactive peers.
export const REMOTE_SIGNATURE_SCHEME_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Refresh a working stored row's expiry at most once per 24 hours per host so
// active RFC 9421 peers do not re-knock every week without adding per-request
// database writes.
export const REMOTE_SIGNATURE_SCHEME_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

type CachedSchemeEntry = {
  dbExpiresAt: number | null
  expiresAt: number
  scheme: SignatureScheme | null
}

type SignatureSchemeStore = Pick<
  Database,
  'getRemoteSignatureScheme' | 'upsertRemoteSignatureScheme'
>

const rememberedSchemes = new Map<string, CachedSchemeEntry>()

const normalizeHostKey = (value: string): string | null =>
  normalizeActorHost(value)

const normalizeComparableHost = (value: string): string =>
  normalizeActorHost(value) ?? value.trim().toLowerCase()

const isEntryFresh = (entry: CachedSchemeEntry, now: number): boolean =>
  entry.expiresAt > now &&
  (entry.dbExpiresAt === null || entry.dbExpiresAt > now)

const setCachedScheme = (
  key: string,
  entry: CachedSchemeEntry,
  now: number
): void => {
  rememberedSchemes.delete(key)
  if (rememberedSchemes.size >= REMEMBERED_SIGNATURE_SCHEME_MAX_HOSTS) {
    for (const [entryKey, existing] of rememberedSchemes) {
      if (!isEntryFresh(existing, now)) rememberedSchemes.delete(entryKey)
    }
    while (rememberedSchemes.size >= REMEMBERED_SIGNATURE_SCHEME_MAX_HOSTS) {
      const oldest = rememberedSchemes.keys().next().value
      if (oldest === undefined) break
      rememberedSchemes.delete(oldest)
    }
  }
  rememberedSchemes.set(key, entry)
}

const resolveSchemeStore = (
  database: Database | null | undefined
): SignatureSchemeStore | null => {
  const resolved = database === undefined ? getDatabase() : database
  if (
    !resolved ||
    typeof resolved.getRemoteSignatureScheme !== 'function' ||
    typeof resolved.upsertRemoteSignatureScheme !== 'function'
  ) {
    return null
  }
  return resolved
}

/**
 * The scheme currently cached in process for `host`, or null when nothing (or
 * a negative entry) is cached.
 */
export const getRememberedSignatureScheme = (
  host: string
): SignatureScheme | null => {
  const key = normalizeHostKey(host)
  if (!key) return null
  const entry = rememberedSchemes.get(key)
  if (!entry) return null
  const now = Date.now()
  if (!isEntryFresh(entry, now)) {
    rememberedSchemes.delete(key)
    return null
  }
  // Re-insert so the oldest-first eviction behaves like an LRU.
  rememberedSchemes.delete(key)
  rememberedSchemes.set(key, entry)
  return entry.scheme
}

/** Cache `scheme` in process for `host` for `SIGNATURE_SCHEME_CACHE_TTL_MS`. */
export const rememberSignatureScheme = (
  host: string,
  scheme: SignatureScheme
): void => {
  const key = normalizeHostKey(host)
  if (!key) return
  const now = Date.now()
  setCachedScheme(
    key,
    {
      scheme,
      expiresAt: now + SIGNATURE_SCHEME_CACHE_TTL_MS,
      dbExpiresAt: null
    },
    now
  )
}

/** Drops every in-process cached scheme. Tests use it; production never needs to. */
export const clearRememberedSignatureSchemes = (): void => {
  rememberedSchemes.clear()
}

const readPrimarySignatureScheme = async (
  hostKey: string | null,
  database: Database | null | undefined
): Promise<{ dbExpiresAt: number | null; scheme: SignatureScheme }> => {
  if (!hostKey) return { scheme: 'cavage', dbExpiresAt: null }

  const now = Date.now()
  const cached = rememberedSchemes.get(hostKey)
  let staleFallbackScheme: SignatureScheme | null = null
  // On a database failure, keep serving what was known (or the default) for
  // one cache TTL, so an outage costs one read and one warning per host per
  // TTL instead of one per request.
  const fallBack = () => {
    const dbExpiresAt =
      staleFallbackScheme !== null ? (cached?.dbExpiresAt ?? null) : null
    setCachedScheme(
      hostKey,
      {
        scheme: staleFallbackScheme,
        expiresAt:
          dbExpiresAt === null
            ? now + SIGNATURE_SCHEME_CACHE_TTL_MS
            : Math.min(now + SIGNATURE_SCHEME_CACHE_TTL_MS, dbExpiresAt),
        dbExpiresAt
      },
      now
    )
    return { scheme: staleFallbackScheme ?? 'cavage', dbExpiresAt: null }
  }
  if (cached) {
    if (isEntryFresh(cached, now)) {
      rememberedSchemes.delete(hostKey)
      rememberedSchemes.set(hostKey, cached)
      return {
        scheme: cached.scheme ?? 'cavage',
        dbExpiresAt: cached.dbExpiresAt
      }
    }
    if (cached.dbExpiresAt === null || cached.dbExpiresAt > now) {
      staleFallbackScheme = cached.scheme
    }
    rememberedSchemes.delete(hostKey)
  }

  let store: SignatureSchemeStore | null
  try {
    store = resolveSchemeStore(database)
  } catch (error) {
    logger.warn({
      message:
        'Failed to resolve database for remote signature scheme; using fallback',
      host: hostKey,
      err: toLoggableError(error)
    })
    return fallBack()
  }

  if (!store) {
    setCachedScheme(
      hostKey,
      {
        scheme: null,
        expiresAt: now + SIGNATURE_SCHEME_CACHE_TTL_MS,
        dbExpiresAt: null
      },
      now
    )
    return { scheme: 'cavage', dbExpiresAt: null }
  }

  try {
    const stored = await store.getRemoteSignatureScheme({
      domain: hostKey,
      now
    })
    const completedAt = Date.now()
    if (stored && stored.expiresAt > completedAt) {
      setCachedScheme(
        hostKey,
        {
          scheme: stored.scheme,
          expiresAt: Math.min(
            completedAt + SIGNATURE_SCHEME_CACHE_TTL_MS,
            stored.expiresAt
          ),
          dbExpiresAt: stored.expiresAt
        },
        completedAt
      )
      return { scheme: stored.scheme, dbExpiresAt: stored.expiresAt }
    }

    setCachedScheme(
      hostKey,
      {
        scheme: null,
        expiresAt: completedAt + SIGNATURE_SCHEME_CACHE_TTL_MS,
        dbExpiresAt: null
      },
      completedAt
    )
    return { scheme: 'cavage', dbExpiresAt: null }
  } catch (error) {
    logger.warn({
      message:
        'Failed to read remote signature scheme from database; using fallback',
      host: hostKey,
      err: toLoggableError(error)
    })
    return fallBack()
  }
}

const persistSignatureScheme = async (
  hostKey: string | null,
  scheme: SignatureScheme,
  database: Database | null | undefined
): Promise<void> => {
  if (!hostKey) return

  const now = Date.now()
  const nextDbExpiresAt = now + REMOTE_SIGNATURE_SCHEME_TTL_MS
  setCachedScheme(
    hostKey,
    {
      scheme,
      expiresAt: now + SIGNATURE_SCHEME_CACHE_TTL_MS,
      dbExpiresAt: nextDbExpiresAt
    },
    now
  )

  try {
    const store = resolveSchemeStore(database)
    if (!store) return
    await store.upsertRemoteSignatureScheme({
      domain: hostKey,
      scheme,
      expiresAt: nextDbExpiresAt,
      now
    })
  } catch (error) {
    logger.warn({
      message:
        'Failed to persist remote signature scheme to database; keeping in-memory value',
      host: hostKey,
      scheme,
      err: toLoggableError(error)
    })
  }
}

const maybeRefreshSignatureScheme = async (
  hostKey: string | null,
  scheme: SignatureScheme,
  dbExpiresAt: number | null,
  database: Database | null | undefined
): Promise<void> => {
  if (!hostKey || dbExpiresAt === null) return

  const now = Date.now()
  const refreshWindowMs =
    REMOTE_SIGNATURE_SCHEME_TTL_MS - REMOTE_SIGNATURE_SCHEME_REFRESH_INTERVAL_MS
  if (dbExpiresAt - now > refreshWindowMs) return

  const nextDbExpiresAt = now + REMOTE_SIGNATURE_SCHEME_TTL_MS
  setCachedScheme(
    hostKey,
    {
      scheme,
      expiresAt: now + SIGNATURE_SCHEME_CACHE_TTL_MS,
      dbExpiresAt: nextDbExpiresAt
    },
    now
  )

  try {
    const store = resolveSchemeStore(database)
    if (!store) return
    await store.upsertRemoteSignatureScheme({
      domain: hostKey,
      scheme,
      expiresAt: nextDbExpiresAt,
      now
    })
  } catch (error) {
    logger.warn({
      message: 'Failed to refresh remote signature scheme expiry in database',
      host: hostKey,
      scheme,
      err: toLoggableError(error)
    })
  }
}

export interface SignedActivityPubRequestOptions {
  /** The actor whose key signs the request. Without a key the request is unsigned. */
  actor?: Actor | null
  accept?: string
  /** The serialized request body, exactly as it is sent. */
  body?: string
  /** Optional database override; defaults to `getDatabase()`. */
  database?: Database | null
  method: 'GET' | 'POST'
  /**
   * Whether a scheme this request learns is written to the shared table
   * (default true). Requests a stranger can trigger before anything is
   * verified (the inbox guard's key fetch, whose host the sender picks) pass
   * false: they still read it, and learn into the short in-process cache only.
   */
  persistScheme?: boolean
  /** Everything `request()` takes except the URL, method, headers and body. */
  requestOptions?: Omit<RequestOptions, 'body' | 'headers' | 'method' | 'url'>
  url: string
}

const toSignedMethod = (method: string): 'GET' | 'POST' =>
  method.toUpperCase() === 'POST' ? 'POST' : 'GET'

// A POST is only re-knocked on 401: a 403 is a policy answer, not a signature
// one. A GET is read-only, so a 403 is worth one more try with the other
// scheme.
const shouldKnock = (method: 'GET' | 'POST', statusCode: number): boolean =>
  method === 'POST'
    ? statusCode === 401
    : statusCode === 401 || statusCode === 403

const isSuccess = (statusCode: number): boolean =>
  statusCode >= 200 && statusCode < 300

/**
 * Signed ActivityPub request with a bounded double-knock.
 *
 * The primary scheme is the one remembered for the target host in
 * `remote_signature_schemes` (cached briefly in process, defaulting to
 * draft-cavage). A 401 (POST) or 401/403 (GET) from the same host is retried
 * once with the other scheme; a 2xx on that second knock remembers it only
 * when neither knock crossed hosts, including chains returning to the initial
 * host. A failed or throwing second knock returns the first response unchanged
 * so delivery classification sees exactly what it saw before.
 *
 * Headers are built per hop, so a same-host redirect is re-signed over its own
 * URL. A hop onto another host is never signed.
 */
export const signedActivityPubRequest = async ({
  actor,
  accept = DEFAULT_ACCEPT,
  body,
  database,
  method,
  persistScheme = true,
  requestOptions,
  url
}: SignedActivityPubRequestOptions): Promise<RequestResult> => {
  const rawUrlHost = new URL(url).host
  const initialHost = normalizeComparableHost(rawUrlHost)
  const hostKey = normalizeHostKey(rawUrlHost)
  const hasSigningKey = Boolean(actor?.privateKey)
  const { scheme: primary, dbExpiresAt } = hasSigningKey
    ? await readPrimarySignatureScheme(hostKey, database)
    : { scheme: 'cavage' as SignatureScheme, dbExpiresAt: null }

  const send = async (
    scheme: SignatureScheme,
    overrides: Pick<RequestOptions, 'numberOfRetry' | 'responseTimeout'>
  ) => {
    let crossedHosts = false
    const response = await request({
      ...requestOptions,
      ...overrides,
      url,
      method,
      body,
      headers: ({ body: hopBody, method: hopMethod, url: hopUrl }) => {
        if (normalizeComparableHost(hopUrl.host) !== initialHost) {
          crossedHosts = true
          // Never signed off-host, but a redirected POST keeps its unsigned
          // date, digest and content-type, as it did before per-hop headers.
          return actor
            ? {
                ...signedHeaders(
                  { ...actor, privateKey: undefined },
                  toSignedMethod(hopMethod),
                  hopUrl.toString(),
                  hopBody
                ),
                accept
              }
            : { accept }
        }
        const signedMethod = toSignedMethod(hopMethod)
        if (hasSigningKey && scheme === 'rfc9421') {
          const signed = signHttpMessage({
            body: hopBody,
            keyId: `${(actor as Actor).id}#main-key`,
            method: signedMethod,
            passphrase: getConfig().secretPhase,
            privateKey: (actor as Actor).privateKey as string,
            url: hopUrl.toString()
          })
          return { ...signed.headers, accept }
        }
        return activityPubRequestHeaders({
          url: hopUrl.toString(),
          method: signedMethod,
          signingActor: actor,
          body: hopBody,
          accept
        })
      }
    })
    crossedHosts ||=
      normalizeComparableHost(new URL(response.url ?? url).host) !== initialHost
    return { response, crossedHosts }
  }

  // What a 2xx proves about the host: a POST reached its inbox, but a GET
  // only counts when it returned an ActivityPub document. An HTML page or an
  // anonymous fallback on some other path says nothing about which scheme the
  // host's inbox needs, so it must not set the scheme every delivery uses.
  const provesScheme = (response: RequestResult) =>
    method === 'POST' ||
    isActivityPubContentType(getHeaderValue(response.headers, 'content-type'))

  const startedAt = Date.now()
  const { response: first, crossedHosts } = await send(primary, {})
  if (!hasSigningKey) return first

  if (isSuccess(first.statusCode)) {
    if (!crossedHosts && persistScheme && provesScheme(first)) {
      await maybeRefreshSignatureScheme(hostKey, primary, dbExpiresAt, database)
    }
    return first
  }

  if (!shouldKnock(method, first.statusCode)) return first

  // A cross-host redirect deliberately dropped the signature, so its answer
  // says nothing about the scheme this host accepts.
  if (crossedHosts) return first

  const alternate: SignatureScheme = primary === 'cavage' ? 'rfc9421' : 'cavage'
  try {
    // Match request()'s explicit-timeout fallback to the runtime server setting.
    const budget =
      requestOptions?.responseTimeout ||
      (await getResolvedServerSettings()).network.requestTimeoutMs
    const remaining = budget - (Date.now() - startedAt)
    if (remaining <= 0) return first

    const { response: second, crossedHosts: secondCrossedHosts } = await send(
      alternate,
      {
        numberOfRetry: 0,
        responseTimeout: remaining
      }
    )
    if (!isSuccess(second.statusCode)) return first

    if (!secondCrossedHosts && provesScheme(second)) {
      if (persistScheme) {
        await persistSignatureScheme(hostKey, alternate, database)
      } else if (hostKey) {
        rememberSignatureScheme(hostKey, alternate)
      }
    }
    return second
  } catch (error) {
    // Knock 2 is a scheme probe: its failure must not replace Knock 1's
    // authentication response with a network failure for delivery tracking,
    // but a signer bug here would otherwise never surface.
    logger.warn({
      message: 'Second signature knock failed; keeping the first response',
      host: initialHost,
      scheme: alternate,
      err: toLoggableError(error)
    })
    return first
  }
}
