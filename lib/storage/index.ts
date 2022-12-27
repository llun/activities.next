import memoize from 'lodash/memoize'

import { BaseNote } from '../activities/entities/note'
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
  note: BaseNote
  storage: Storage
}
export const deliverTo = async ({ note, storage }: DeliverToParams) => {
  const addresses = await Promise.all(
    [...[note.to].flat(), ...[note.cc].flat()].map(async (item) => {
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
  return addresses.flat().filter((item): item is string => Boolean(item))
}
