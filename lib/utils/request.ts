import { getConfig } from '@/lib/config'
import {
  DEFAULT_SAFE_REMOTE_FETCH_MAX_BODY_BYTES,
  SafeRemoteFetchHeaders,
  SafeRemoteFetchMethod,
  safeRemoteFetch
} from '@/lib/utils/safeRemoteFetch'
import packageJson from '@/package.json'

const USER_AGENT = `activities.next/${packageJson.version}`
const DEFAULT_RESPONSE_TIMEOUT = 10000
const MAX_RETRY_LIMIT = 1
const DEFAULT_RETRY_NOISE = 100
const RETRY_BACKOFF_LIMIT = Number.POSITIVE_INFINITY
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
  'ECONNRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT'
])

const SHARED_HEADERS = {
  'User-Agent': USER_AGENT
}

export interface RequestOptions {
  url: string
  method?: SafeRemoteFetchMethod
  headers?: SafeRemoteFetchHeaders
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

const getRequestOptions = ({
  method = 'GET',
  headers,
  body,
  responseTimeout,
  numberOfRetry,
  retryNoise,
  maxResponseSize
}: Omit<RequestOptions, 'url'>) => {
  const config = getConfig()
  const retryLimit = config.request?.numberOfRetry ?? MAX_RETRY_LIMIT
  const configuredRetryNoise = config.request?.retryNoise ?? DEFAULT_RETRY_NOISE
  const defaultResponseTimeout =
    responseTimeout ||
    config.request?.timeoutInMilliseconds ||
    DEFAULT_RESPONSE_TIMEOUT
  const maxBodyBytes =
    typeof maxResponseSize === 'number'
      ? maxResponseSize
      : (config.request?.maxResponseSizeInBytes ??
        DEFAULT_SAFE_REMOTE_FETCH_MAX_BODY_BYTES)

  return {
    body,
    connectTimeoutInMilliseconds: defaultResponseTimeout,
    headers: {
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

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const getRetryDelay = (attempt: number, retryNoise: number | null) => {
  const noise = retryNoise ? Math.random() * retryNoise : 0
  return Math.min(2 ** attempt * 1000, RETRY_BACKOFF_LIMIT) + noise
}

const isRetryableRequestError = (
  error: unknown,
  method: SafeRemoteFetchMethod
) => {
  const code = (error as NodeJS.ErrnoException).code
  return (
    RETRYABLE_METHODS.has(method.toUpperCase()) &&
    typeof code === 'string' &&
    RETRYABLE_ERROR_CODES.has(code)
  )
}

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
  const options = getRequestOptions({
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
      return await safeRemoteFetch({
        body: options.body,
        connectTimeoutInMilliseconds: options.connectTimeoutInMilliseconds,
        headers: options.headers,
        maxBodyBytes: options.maxBodyBytes,
        method: options.method,
        readTimeoutInMilliseconds: options.readTimeoutInMilliseconds,
        timeoutInMilliseconds: options.timeoutInMilliseconds,
        url
      })
    } catch (error) {
      if (
        attempt >= options.numberOfRetry ||
        !isRetryableRequestError(error, method)
      ) {
        throw error
      }
      attempt += 1
      await wait(getRetryDelay(attempt - 1, options.retryNoise))
    }
  }
}
