import { getConfig } from '@/lib/config'
import { safeRemoteFetch } from '@/lib/utils/safeRemoteFetch'
import packageJson from '@/package.json'

import {
  CircuitBreaker,
  Limiter,
  LookupRateLimitedError,
  parseRetryAfterMs
} from './rateLimit'

// What a failed lookup looked like, for logs and for the persisted `failed`
// status. None of them is retried by the caller: a job records the failure and
// returns, so a rate-limited free service is never hammered.
export type LookupErrorCode =
  'circuit-open' | 'rate-limited' | 'unavailable' | 'network' | 'http' | 'parse'

export class LookupError extends Error {
  code: LookupErrorCode

  constructor(code: LookupErrorCode, message: string) {
    super(message)
    this.name = 'LookupError'
    this.code = code
  }
}

export type LookupFetch = typeof safeRemoteFetch

export interface LookupProvider {
  name: string
  limiter: Limiter
  breaker: CircuitBreaker
  // Total timeout and its connect share, in milliseconds.
  timeoutMs: number
  connectTimeoutMs: number
  maxBodyBytes: number
}

export const getLookupHeaders = (): Record<string, string> => {
  const { host, languages } = getConfig()
  return {
    'User-Agent': `activities.next/${packageJson.version} (+https://${host})`,
    'Accept-Language': languages?.[0] ?? 'en',
    Accept: 'application/json'
  }
}

export type LookupResponse =
  // 200 with a JSON body.
  | { status: 'ok'; json: unknown }
  // 204 or 404: the provider has nothing for this request.
  | { status: 'empty' }

/**
 * One GET against a lookup provider: circuit breaker, rate limit, timeouts and
 * body cap. Throws LookupError for every failure. A timeout, a 5xx and a 429
 * open the provider's circuit; a 4xx other than 404 does not.
 *
 * Never forwards credentials: the headers are the fixed lookup headers only,
 * and redirects to another host are refused.
 */
export const lookupGet = async ({
  provider,
  url,
  fetch = safeRemoteFetch
}: {
  provider: LookupProvider
  url: string
  fetch?: LookupFetch
}): Promise<LookupResponse> => {
  if (provider.breaker.isOpen()) {
    throw new LookupError(
      'circuit-open',
      `${provider.name} is temporarily unavailable`
    )
  }

  let response
  try {
    response = await provider.limiter(() =>
      fetch({
        url,
        method: 'GET',
        headers: getLookupHeaders(),
        allowCrossHostRedirects: false,
        timeoutInMilliseconds: provider.timeoutMs,
        connectTimeoutInMilliseconds: provider.connectTimeoutMs,
        readTimeoutInMilliseconds:
          provider.timeoutMs - provider.connectTimeoutMs,
        maxBodyBytes: provider.maxBodyBytes
      })
    )
  } catch (error) {
    if (error instanceof LookupRateLimitedError) {
      throw new LookupError('rate-limited', `${provider.name} rate limited`)
    }
    // An unsafe address, a refused redirect or an oversized body is a problem
    // with this request or endpoint, not evidence the provider is down.
    const code = (error as { code?: unknown } | undefined)?.code
    const isRequestProblem =
      typeof code === 'string' &&
      (code === 'ERR_UNSAFE_REMOTE_URL' ||
        code === 'ERR_CROSS_HOST_REDIRECT' ||
        code === 'ERR_RESPONSE_TOO_LARGE' ||
        code === 'ERR_TOO_MANY_REDIRECTS')
    if (!isRequestProblem) provider.breaker.open()
    throw new LookupError(
      'network',
      `${provider.name} request failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  const { statusCode } = response
  if (statusCode === 429 || statusCode >= 500) {
    provider.breaker.open(parseRetryAfterMs(response.headers['retry-after']))
    throw new LookupError(
      'unavailable',
      `${provider.name} answered ${statusCode}`
    )
  }
  if (statusCode === 204 || statusCode === 404) return { status: 'empty' }
  if (statusCode < 200 || statusCode >= 300) {
    throw new LookupError('http', `${provider.name} answered ${statusCode}`)
  }

  try {
    return { status: 'ok', json: JSON.parse(response.body) }
  } catch {
    throw new LookupError('parse', `${provider.name} returned invalid JSON`)
  }
}
