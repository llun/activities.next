import got from 'got'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readable } from 'node:stream'

import {
  ResolvedRemoteAddress,
  createFixedDnsLookup
} from '@/lib/utils/safeRemoteFetch'
import { isUnsafeAddress, normalizeHostname } from '@/lib/utils/unsafeAddress'

/**
 * Downloading an image from a URL this instance did not choose — a Strava photo
 * URL handed to us by Strava's API, a remote attachment URL a federating actor
 * put on a note.
 *
 * This is deliberately NOT `safeRemoteFetch`. That guard reads the response
 * body as a UTF-8 string (`Buffer.concat(chunks).toString('utf8')`), which
 * mangles image bytes, so a binary download needs its own transport. What is
 * reusable is the URL check, the redirect discipline, and the pinned lookup,
 * and that is what lives here: callers pair `safeImageFetch` with a
 * content-type check and `readResponseArrayBufferWithLimit` for the byte cap.
 *
 * The address policy itself is NOT reimplemented here — `isUnsafeAddress` from
 * `@/lib/utils/unsafeAddress` is the one implementation, shared with
 * `safeRemoteFetch`. A hand-rolled `BlockList` copy lived here briefly and
 * diverged from it in five places within three rounds of review.
 *
 * The resolved address is pinned into the connection through the same
 * `createFixedDnsLookup` that `safeRemoteFetch` uses, so the request cannot be
 * re-resolved to a different address between the check and the connect (the
 * DNS-rebinding race a plain `fetch` leaves open).
 */
// Same ceiling `safeRemoteFetch` applies (DEFAULT_SAFE_REMOTE_FETCH_MAX_REDIRECTS).
export const MAX_SAFE_IMAGE_REDIRECTS = 3
export const DEFAULT_SAFE_IMAGE_TIMEOUT_MS = 10_000

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])

export const isRestrictedDownloadHostname = (hostname: string) => {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  )
}

export const isRestrictedDownloadAddress = (address: string) =>
  isUnsafeAddress(address)

type SafeImageDownloadTarget = {
  addresses: ResolvedRemoteAddress[]
  url: URL
}

/**
 * Returns the parsed URL and the addresses it resolved to when it is safe to
 * download from, or `null` when it is not — a non-HTTPS scheme, embedded
 * credentials, a hostname that names the local network, or a hostname that
 * resolves to ANY restricted address. Every resolved address is checked, not
 * just the first, so a DNS record mixing a public and a private answer is
 * rejected.
 *
 * The addresses are returned so the caller can pin them into the connection
 * rather than letting the transport resolve the name a second time.
 */
const resolveSafeImageDownloadTarget = async (
  rawUrl: string
): Promise<SafeImageDownloadTarget | null> => {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'https:' || url.username || url.password) {
    return null
  }

  // `new URL(...).hostname` keeps the brackets on an IPv6 literal, and `isIP`
  // answers 0 for a bracketed address — which would send every IPv6 literal
  // down the DNS branch, where resolving an address rather than a name fails.
  // `normalizeHostname` strips them the way the address policy expects.
  const hostname = normalizeHostname(url.hostname.trim())
  if (!hostname || isRestrictedDownloadHostname(hostname)) {
    return null
  }

  const ipVersion = isIP(hostname)
  if (ipVersion) {
    if (isRestrictedDownloadAddress(hostname)) return null
    return {
      addresses: [{ address: hostname, family: ipVersion as 4 | 6 }],
      url
    }
  }

  const resolvedAddresses = await lookup(hostname, {
    all: true,
    verbatim: true
  }).catch(() => [])

  if (
    resolvedAddresses.length === 0 ||
    resolvedAddresses.some(({ address }) =>
      isRestrictedDownloadAddress(address)
    )
  ) {
    return null
  }

  return {
    addresses: resolvedAddresses.map(({ address, family }) => ({
      address,
      family: family as 4 | 6
    })),
    url
  }
}

/**
 * Returns the parsed URL when it is safe to download from, or `null` when it is
 * not. See `resolveSafeImageDownloadTarget` for the policy.
 */
export const getSafeImageDownloadUrl = async (rawUrl: string) =>
  (await resolveSafeImageDownloadTarget(rawUrl))?.url ?? null

const toResponseHeaders = (
  headers: Record<string, string | string[] | undefined>
) => {
  const result = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue
    result.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  return result
}

const NULL_BODY_STATUS_CODES = new Set([204, 205, 304])

/**
 * Issues one request to an already-validated target, pinning the resolved
 * address into the connection so the transport cannot re-resolve the name.
 * Returns a real `Response` so callers keep using `response.ok`,
 * `response.headers` and `readResponseArrayBufferWithLimit` unchanged.
 */
const requestImage = (
  target: SafeImageDownloadTarget,
  signal: AbortSignal
): Promise<Response> =>
  new Promise((resolve, reject) => {
    const stream = got.stream(target.url.toString(), {
      dnsLookup: createFixedDnsLookup(target.addresses),
      followRedirect: false,
      retry: { limit: 0 },
      signal,
      throwHttpErrors: false
    })
    let settled = false

    // Settle once, and always leave the stream with an error listener: a
    // destroy mid-response can emit `error`, and an unhandled `error` event on
    // a stream throws out of the event loop.
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      stream.off('error', fail)
      stream.on('error', () => undefined)
      stream.destroy()
      reject(error)
    }

    stream.once('error', fail)
    stream.once('response', (response) => {
      if (settled) return
      try {
        const status = response.statusCode
        // `Response` only accepts 200..599 and throws a `RangeError` for
        // anything else. That throw used to escape this listener after the
        // error listener had been detached, so the promise never settled and
        // `safeImageFetch` hung past every deadline. Validate first.
        if (!Number.isInteger(status) || status < 200 || status > 599) {
          throw new Error(`Unexpected HTTP status ${String(status)}`)
        }

        // `Response` refuses a body on a null-body status, and a 204/304
        // carries none anyway; hand it `null` and release the socket.
        const nullBody = NULL_BODY_STATUS_CODES.has(status)
        const body = nullBody
          ? null
          : (Readable.toWeb(stream) as ReadableStream)
        const result = new Response(body, {
          headers: toResponseHeaders(response.headers),
          status
        })

        settled = true
        stream.off('error', fail)
        if (nullBody) {
          stream.on('error', () => undefined)
          stream.destroy()
        }
        resolve(result)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
  })

/**
 * Fetches a URL this instance did not choose, re-running the guard on EVERY
 * redirect hop.
 *
 * Guarding only the URL a caller hands in guards nothing: a transport that
 * follows redirects by default would carry the request to a target the guard
 * never saw — and Node applies no mixed-content rule, so an https URL can
 * redirect to plain http on loopback. Hops are therefore taken by hand.
 *
 * Returns the first non-redirect response, or `null` when a hop is refused, a
 * redirect carries no usable `Location`, or the hop budget runs out. The caller
 * still owns the content-type check and the byte cap.
 *
 * `timeoutMs` is PER HOP and restarts on each one, so on its own it bounds a
 * single request and not the call: the loop makes up to
 * `MAX_SAFE_IMAGE_REDIRECTS + 1` fetches, so a host that stalls just under the
 * limit at every hop costs that multiple. A caller that needs a real ceiling —
 * one looping over attacker-supplied URLs, say — passes `signal` as an overall
 * deadline; it is combined with each hop's own timeout rather than replacing
 * it, so whichever expires first wins.
 */
export const safeImageFetch = async (
  rawUrl: string,
  {
    timeoutMs = DEFAULT_SAFE_IMAGE_TIMEOUT_MS,
    signal
  }: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<Response | null> => {
  let target = rawUrl

  for (let hop = 0; hop <= MAX_SAFE_IMAGE_REDIRECTS; hop += 1) {
    const safeTarget = await resolveSafeImageDownloadTarget(target)
    if (!safeTarget) return null

    const hopTimeout = AbortSignal.timeout(timeoutMs)
    const response = await requestImage(
      safeTarget,
      signal ? AbortSignal.any([hopTimeout, signal]) : hopTimeout
    )
    if (!REDIRECT_STATUS_CODES.has(response.status)) return response

    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => undefined)
    if (!location) return null

    try {
      // A `Location` may be relative; resolve it against the hop we just made.
      target = new URL(location, safeTarget.url).toString()
    } catch {
      return null
    }
  }

  return null
}
