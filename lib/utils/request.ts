import { getConfig } from '@/lib/config'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { getHeaderValue } from '@/lib/utils/getHeaderValue'
import {
  SafeRemoteFetchHeaderBuilderRequest,
  SafeRemoteFetchHeaderSource,
  SafeRemoteFetchMethod,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'
import { waitFor } from '@/lib/utils/waitFor'
import packageJson from '@/package.json'

const USER_AGENT = `activities.next/${packageJson.version}`
const DEFAULT_RETRY_NOISE = 100
const RETRY_BACKOFF_LIMIT = 30_000
const RETRYABLE_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PUT',
  'TRACE'
])
const RETRYABLE_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'EADDRINUSE',
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT'
])
const RETRYABLE_STATUS_CODES = new Set([
  408, 429, 500, 502, 503, 504, 521, 522, 524
])
const NON_RETRYABLE_SAFE_REMOTE_FETCH_ERROR_CODES = new Set([
  'ERR_UNSAFE_REMOTE_URL',
  'ERR_RESPONSE_TOO_LARGE',
  'ERR_TOO_MANY_REDIRECTS'
])

const SHARED_HEADERS = {
  'User-Agent': USER_AGENT
}

export interface RequestOptions {
  url: string
  method?: SafeRemoteFetchMethod
  headers?: SafeRemoteFetchHeaderSource
  body?: string
  responseTimeout?: number
  numberOfRetry?: number
  retryNoise?: number | null
  maxResponseSize?: number
}

export interface RequestResult {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

const getRequestOptions = async ({
  method = 'GET',
  headers,
  body,
  responseTimeout,
  numberOfRetry,
  retryNoise,
  maxResponseSize
}: Omit<RequestOptions, 'url'>) => {
  const config = getConfig()
  // Timeout, retries, and the response-size cap are database-backed settings
  // (env -> database -> default). retryNoise stays an env-only knob.
  const { network } = await getResolvedServerSettings()
  const retryLimit = network.requestRetries
  const configRetryNoise = config.request?.retryNoise
  const configuredRetryNoise =
    typeof configRetryNoise === 'number' || configRetryNoise === null
      ? configRetryNoise
      : DEFAULT_RETRY_NOISE
  const defaultResponseTimeout = responseTimeout || network.requestTimeoutMs
  const maxBodyBytes =
    typeof maxResponseSize === 'number'
      ? maxResponseSize
      : network.maxResponseSizeBytes

  return {
    body,
    connectTimeoutInMilliseconds: defaultResponseTimeout,
    headers:
      typeof headers === 'function'
        ? (request: SafeRemoteFetchHeaderBuilderRequest) => ({
            ...SHARED_HEADERS,
            ...headers(request)
          })
        : {
            ...SHARED_HEADERS,
            ...headers
          },
    maxBodyBytes,
    method,
    numberOfRetry:
      typeof numberOfRetry === 'number' ? numberOfRetry : retryLimit,
    retryNoise:
      typeof retryNoise === 'number' || retryNoise === null
        ? retryNoise
        : configuredRetryNoise,
    readTimeoutInMilliseconds: defaultResponseTimeout,
    timeoutInMilliseconds: defaultResponseTimeout
  }
}

const getRetryDelay = (attempt: number, retryNoise: number | null) => {
  const noise = retryNoise ? Math.random() * Math.abs(retryNoise) : 0
  return Math.min(2 ** attempt * 1000 + noise, RETRY_BACKOFF_LIMIT)
}

const getRetryAfterDelay = (headers: RequestResult['headers']) => {
  const retryAfter = getHeaderValue(headers, 'retry-after')
  if (!retryAfter) return undefined

  const seconds = Number(retryAfter)
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000)
  }

  const retryAt = Date.parse(retryAfter)
  if (!Number.isFinite(retryAt)) return undefined

  return Math.max(1, retryAt - Date.now())
}

const getStatusRetryDelay = ({
  attempt,
  headers,
  retryNoise,
  timeoutInMilliseconds
}: {
  attempt: number
  headers: RequestResult['headers']
  retryNoise: number | null
  timeoutInMilliseconds: number
}) => {
  const retryAfterDelay = getRetryAfterDelay(headers)
  if (typeof retryAfterDelay === 'number') {
    return retryAfterDelay > timeoutInMilliseconds ? null : retryAfterDelay
  }

  return getRetryDelay(attempt, retryNoise)
}

const isRetryableRequestError = (
  error: unknown,
  method: SafeRemoteFetchMethod
) => {
  const code = (error as NodeJS.ErrnoException).code
  if (
    typeof code === 'string' &&
    NON_RETRYABLE_SAFE_REMOTE_FETCH_ERROR_CODES.has(code)
  ) {
    return false
  }

  return (
    RETRYABLE_METHODS.has(method.toUpperCase()) &&
    typeof code === 'string' &&
    RETRYABLE_ERROR_CODES.has(code)
  )
}

const isRetryableStatusCode = (
  statusCode: number,
  method: SafeRemoteFetchMethod
) =>
  RETRYABLE_METHODS.has(method.toUpperCase()) &&
  RETRYABLE_STATUS_CODES.has(statusCode)

export const request = async ({
  url,
  method = 'GET',
  headers,
  body,
  responseTimeout,
  numberOfRetry,
  retryNoise,
  maxResponseSize
}: RequestOptions): Promise<RequestResult> => {
  const options = await getRequestOptions({
    method,
    headers,
    body,
    responseTimeout,
    numberOfRetry,
    retryNoise,
    maxResponseSize
  })
  let attempt = 0

  while (true) {
    try {
      const response = await safeRemoteFetch({
        body: options.body,
        connectTimeoutInMilliseconds: options.connectTimeoutInMilliseconds,
        headers: options.headers,
        maxBodyBytes: options.maxBodyBytes,
        method: options.method,
        readTimeoutInMilliseconds: options.readTimeoutInMilliseconds,
        timeoutInMilliseconds: options.timeoutInMilliseconds,
        url
      })

      if (
        attempt >= options.numberOfRetry ||
        !isRetryableStatusCode(response.statusCode, method)
      ) {
        return response
      }

      const retryDelay = getStatusRetryDelay({
        attempt,
        headers: response.headers,
        retryNoise: options.retryNoise,
        timeoutInMilliseconds: options.timeoutInMilliseconds
      })
      if (retryDelay === null) return response

      attempt += 1
      await waitFor(retryDelay)
    } catch (error) {
      if (
        attempt >= options.numberOfRetry ||
        !isRetryableRequestError(error, method)
      ) {
        throw error
      }
      attempt += 1
      await waitFor(getRetryDelay(attempt - 1, options.retryNoise))
    }
  }
}
