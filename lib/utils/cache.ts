import KeyvRedis from '@keyv/redis'
import { KeyvRedisOptions } from '@keyv/redis/dist/types'

import { getConfig } from '../config'

export const cache = (
  key: string,
  content: unknown,
  ttl: number = 86400000
) => {
  const config = getConfig()
  if (!config.redis) {
    return content
  }

  const { url, tls } = config.redis
  const option = tls ? ({ tls: {} } as KeyvRedisOptions) : undefined
  const keyv = new KeyvRedis(url, option)
  if (!keyv.get(key)) {
    keyv.set(key, content, ttl)
    return content
  }

  return keyv.get(key)
}
