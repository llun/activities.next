import KeyvRedis from '@keyv/redis'
import Keyv from 'keyv'
import { memoize } from 'lodash'

import { getConfig } from '../config'

const getKeyv = memoize((namespace: string) => {
  const config = getConfig()
  if (!config.redis) {
    return null
  }

  const { url } = config.redis
  return new Keyv({ store: new KeyvRedis({ uri: url }), namespace })
})

export const cache = async <P>(
  namespace: string,
  key: string,
  contentFetcher: () => Promise<P>,
  ttl: number = 86400000
): Promise<P> => {
  const keyv = getKeyv(namespace)
  if (!keyv) return contentFetcher()
  if (!(await keyv.has(key))) {
    const content = await contentFetcher()
    await keyv.set(key, content, ttl)
    return content
  }
  const data = await keyv.get(key)
  return data as P
}

export const invalidate = async (namespace: string, key: string) => {
  const keyv = getKeyv(namespace)
  if (!keyv) return
  return keyv.delete(key)
}
