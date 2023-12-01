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

export const cache = async <P>(
  key: string,
  contentFetcher: () => Promise<P>,
  ttl: number = 86400000
): Promise<P> => {
  const keyv = getKeyv()
  if (!keyv) return contentFetcher()
  if (!keyv.get(key)) {
    const content = await contentFetcher()
    keyv.set(key, content, ttl)
    return content
  }
  return keyv.get(key) as P
}

export const invalidate = (key: string) => {
  const keyv = getKeyv()
  if (!keyv) return
  keyv.delete(key)
}
