import KeyvRedis from '@keyv/redis'
import { KeyvRedisOptions } from '@keyv/redis/dist/types'
import { memoize } from 'lodash'

import { getConfig } from '../config'

const getKeyv = memoize(() => {
  const config = getConfig()
  if (!config.redis) {
    return null
  }

  const { url, tls } = config.redis
  const option = tls ? ({ tls: {} } as KeyvRedisOptions) : undefined
  return new KeyvRedis(url, option)
})

export const cache = (
  key: string,
  content: unknown,
  ttl: number = 86400000
) => {
  const keyv = getKeyv()
  if (!keyv) return content
  if (!keyv.get(key)) {
    keyv.set(key, content, ttl)
    return content
  }
  return keyv.get(key)
}

export const invalidate = (key: string) => {
  const keyv = getKeyv()
  if (!keyv) return
  keyv.delete(key)
}
