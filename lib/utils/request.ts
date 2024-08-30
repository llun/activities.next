import KeyvRedis from '@keyv/redis'
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
    const { url } = config.redis
    return new KeyvRedis({ uri: url })
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
