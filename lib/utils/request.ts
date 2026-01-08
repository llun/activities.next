import got, { Headers, Method } from 'got'

import { getConfig } from '@/lib/config'

const USER_AGENT = 'activities.next/0.2'
const DEFAULT_RESPONSE_TIMEOUT = 10000
const MAX_RETRY_LIMIT = 1

const SHARED_HEADERS = {
  'User-Agent': USER_AGENT
}

export interface RequestOptions {
  url: string
  method?: Method
  headers?: Headers
  body?: string
  responseTimeout?: number
  numberOfRetry?: number
}

export const request = ({
  url,
  method = 'GET',
  headers,
  body,
  responseTimeout,
  numberOfRetry
}: RequestOptions) => {
  const config = getConfig()
  const retryLimit = config.request?.numberOfRetry ?? MAX_RETRY_LIMIT
  const retryNoise = config.request?.retryNoise
  const defaultResponseTimeout =
    responseTimeout ||
    config.request?.timeoutInMilliseconds ||
    DEFAULT_RESPONSE_TIMEOUT
  return got(url, {
    headers: {
      ...SHARED_HEADERS,
      ...headers
    },
    timeout: {
      request: defaultResponseTimeout
    },
    retry: {
      limit: typeof numberOfRetry === 'number' ? numberOfRetry : retryLimit,
      ...(typeof retryNoise === 'number' ? { noise: retryNoise } : null)
    },
    throwHttpErrors: false,
    method: method as Method,
    body
  })
}
