import KeyvRedis from '@keyv/redis'
import { KeyvRedisOptions } from '@keyv/redis/dist/types'
import got, { Headers, Method } from 'got'
import { memoize } from 'lodash'

import { getConfig } from '../config'

const USER_AGENT = 'activities.next/0.1'
const DEFAULT_RESPONSE_TIMEOUT = 4000
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
}

export const getRequestCache = memoize(() => {
  const config = getConfig()
  if (config.redis) {
    const { url, tls } = config.redis
    const option = tls ? ({ tls: {} } as KeyvRedisOptions) : undefined
    return new KeyvRedis(url, option)
  }

  return false
})

export const request = ({
  url,
  method = 'GET',
  headers,
  body,
  responseTimeout
}: RequestOptions) => {
  const config = getConfig()
  const retryLimit = config.request?.numberOfRetry ?? MAX_RETRY_LIMIT
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
      response: defaultResponseTimeout
    },
    retry: {
      limit: retryLimit
    },
    throwHttpErrors: false,
    method,
    body,
    cache: getRequestCache()
  })
}
