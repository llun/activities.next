import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { DEFAULT_ACCEPT } from '@/lib/activities/constants'
import { getConfig } from '@/lib/config'
import { normalizeActorHost } from '@/lib/services/federation/domainRules'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { Actor } from '@/lib/types/domain/actor'
import { signHttpMessage } from '@/lib/utils/httpMessageSignature'
import { logger } from '@/lib/utils/logger'
import { RequestOptions, RequestResult, request } from '@/lib/utils/request'
import { signedHeaders } from '@/lib/utils/signature'
import { toLoggableError } from '@/lib/utils/toLoggableError'

export type SignatureScheme = 'cavage' | 'rfc9421'

export const REMEMBERED_SIGNATURE_SCHEME_MAX_HOSTS = 2048
export const REMEMBERED_SIGNATURE_SCHEME_TTL_MS = 6 * 60 * 60 * 1000

type RememberedScheme = {
  expiresAt: number
  scheme: SignatureScheme
}

// shortcut: this memory is per process, so a serverless cold start or another
// worker re-learns a host with one extra knock. It is deliberately cache-only
// (no table, no migration); upgrade it to a shared table once peers that
// reject draft-cavage are common enough that the extra request matters.
const rememberedSchemes = new Map<string, RememberedScheme>()

const normalizeHost = (value: string): string =>
  normalizeActorHost(value) ?? value.trim().toLowerCase()

/** The scheme last seen working for `host`, or null when nothing is remembered. */
export const getRememberedSignatureScheme = (
  host: string
): SignatureScheme | null => {
  const key = normalizeHost(host)
  const entry = rememberedSchemes.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    rememberedSchemes.delete(key)
    return null
  }
  // Re-insert so the oldest-first eviction below behaves like an LRU.
  rememberedSchemes.delete(key)
  rememberedSchemes.set(key, entry)
  return entry.scheme
}

/** Remember `scheme` for `host` for `REMEMBERED_SIGNATURE_SCHEME_TTL_MS`. */
export const rememberSignatureScheme = (
  host: string,
  scheme: SignatureScheme
): void => {
  const key = normalizeHost(host)
  rememberedSchemes.delete(key)
  if (rememberedSchemes.size >= REMEMBERED_SIGNATURE_SCHEME_MAX_HOSTS) {
    const now = Date.now()
    for (const [entryKey, entry] of rememberedSchemes) {
      if (entry.expiresAt <= now) rememberedSchemes.delete(entryKey)
    }
    while (rememberedSchemes.size >= REMEMBERED_SIGNATURE_SCHEME_MAX_HOSTS) {
      const oldest = rememberedSchemes.keys().next().value
      if (oldest === undefined) break
      rememberedSchemes.delete(oldest)
    }
  }
  rememberedSchemes.set(key, {
    expiresAt: Date.now() + REMEMBERED_SIGNATURE_SCHEME_TTL_MS,
    scheme
  })
}

/** Drops every remembered scheme. Tests use it; production never needs to. */
export const clearRememberedSignatureSchemes = (): void => {
  rememberedSchemes.clear()
}

export interface SignedActivityPubRequestOptions {
  /** The actor whose key signs the request. Without a key the request is unsigned. */
  actor?: Actor | null
  accept?: string
  /** The serialized request body, exactly as it is sent. */
  body?: string
  method: 'GET' | 'POST'
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
 * The primary scheme is the one remembered for the target host (default
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
  method,
  requestOptions,
  url
}: SignedActivityPubRequestOptions): Promise<RequestResult> => {
  const initialHost = normalizeHost(new URL(url).host)
  const hasSigningKey = Boolean(actor?.privateKey)
  const primary: SignatureScheme = hasSigningKey
    ? (getRememberedSignatureScheme(initialHost) ?? 'cavage')
    : 'cavage'

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
        if (normalizeHost(hopUrl.host) !== initialHost) {
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
      normalizeHost(new URL(response.url ?? url).host) !== initialHost
    return { response, crossedHosts }
  }

  const startedAt = Date.now()
  const { response: first, crossedHosts } = await send(primary, {})
  if (!hasSigningKey || !shouldKnock(method, first.statusCode)) return first

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

    if (!secondCrossedHosts) rememberSignatureScheme(initialHost, alternate)
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
