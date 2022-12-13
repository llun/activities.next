import { BaseNote } from '../activities/entities/note'
import { getConfig } from '../config'
import { Storage } from '../storage/types'

export const isFollowerId = (id: string) => id.endsWith('/followers')

interface DeliverToParams {
  note: BaseNote
  storage: Storage
}
export const deliverTo = async ({ note, storage }: DeliverToParams) => {
  console.log([...[note.to].flat(), ...[note.cc].flat()])
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
  console.log(addresses)

  return addresses.flat().filter((item): item is string => Boolean(item))
}
