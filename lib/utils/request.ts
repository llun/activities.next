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

  if (process.env.KV_URL) {
    const option = { tls: {} } as KeyvRedisOptions
    return new KeyvRedis(process.env.KV_URL, option)
  }

  return false
})

export const request = ({
  url,
  method = 'GET',
  headers,
  body,
  responseTimeout = DEFAULT_RESPONSE_TIMEOUT
}: RequestOptions) => {
  return got(url, {
    headers: {
      ...SHARED_HEADERS,
      ...headers
    },
    timeout: {
      response: responseTimeout
    },
    retry: {
      limit: MAX_RETRY_LIMIT
    },
    throwHttpErrors: false,
    method,
    body,
    cache: getRequestCache()
  })
}
