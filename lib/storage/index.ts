import memoize from 'lodash/memoize'

import { getConfig } from '../config'
import { FirebaseStorage } from './firebase'
import { Sqlite3Storage } from './sqlite3'
import { Storage } from './types'

export const getStorage = memoize(async (): Promise<Storage | null> => {
  const config = getConfig()
  switch (config.database.type) {
    case 'sqlite3':
      return new Sqlite3Storage(config.database)
    case 'firebase':
      return new FirebaseStorage(config.database)
    default:
      return null
  }
})

export const isFollowerId = (id: string) => id.endsWith('/followers')

interface DeliverToParams {
  from: string
  to: string[]
  cc: string[]
  storage: Storage
}
export const deliverTo = async ({ from, to, cc, storage }: DeliverToParams) => {
  const addresses = await Promise.all(
    [from, ...[to].flat(), ...[cc].flat()].map(async (item) => {
      if (['Public', 'as:Public'].includes(item)) return item
      if (isFollowerId(item)) {
        const id = item.slice(0, item.indexOf('/followers'))
        const followers = await storage.getLocalFollowersForActorId({
          targetActorId: id
        })
        const localFollowers = followers
          .filter((item) =>
            item.actorId.startsWith(`https://${getConfig().host}`)
          )
          .map((item) => item.actorId)
        return localFollowers
      }

      const actor = await storage.getActorFromId({ id: item })
      if (actor) return item
      return null
    })
  )
  return Array.from(
    new Set(addresses.flat().filter((item): item is string => Boolean(item)))
  )
}
