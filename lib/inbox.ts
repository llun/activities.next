import { BaseNote } from './activities/entities/note'
import { Storage } from './storage/types'

interface DeliverToParams {
  note: BaseNote
  storage: Storage
}
export const deliverTo = async ({ note, storage }: DeliverToParams) => {
  const addresses = await Promise.all(
    [...[note.to].flat(), ...[note.cc].flat()].map(async (item) => {
      if (['Public', 'as:Public'].includes(item)) return item
      const actor = await storage.getActorFromId({ id: item })
      if (actor) return item
    })
  )

  return addresses.filter((item) => Boolean(item))
}
