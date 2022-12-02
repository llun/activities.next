import { BaseNote } from './activities/entities/note'
import { getConfig } from './config'
import { Storage } from './storage/types'

export const isLocalFollowerId = (id: string) => {
  if (
    id.startsWith(`https://${getConfig().host}`) &&
    id.endsWith('/followers')
  ) {
    return true
  }
  return false
}

interface DeliverToParams {
  note: BaseNote
  storage: Storage
}
export const deliverTo = async ({ note, storage }: DeliverToParams) => {
  const addresses = await Promise.all(
    [...[note.to].flat(), ...[note.cc].flat()].map(async (item) => {
      if (['Public', 'as:Public'].includes(item)) return item
      if (isLocalFollowerId(item)) {
        const id = item.slice(0, item.indexOf('/followers'))
        console.log(id)
      }

      const actor = await storage.getActorFromId({ id: item })
      if (actor) return item
    })
  )

  return addresses.filter((item) => Boolean(item))
}
