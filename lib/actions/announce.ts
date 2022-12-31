import { AnnounceStatus } from '../activities/actions/announceStatus'
import { Note } from '../activities/entities/note'
import { compact } from '../jsonld'
import { StatusType } from '../models/status'
import { Storage } from '../storage/types'

interface AnnounceParams {
  status: AnnounceStatus
  storage: Storage
}
export const announce = async ({ status, storage }: AnnounceParams) => {
  const compactedStatus = await compact(status)
  const { object } = compactedStatus as AnnounceStatus

  const response = await fetch(object)
  if (response.status !== 200) return

  const boostedStatus = await response.json()
  const compactedBoostedStatus = (await compact(boostedStatus)) as Note
  const existingStatus = await storage.getStatus({
    statusId: compactedBoostedStatus.id
  })
  if (!existingStatus) {
    console.log(compactedBoostedStatus.id)
    await storage.createStatus({
      id: compactedBoostedStatus.id,
      url: compactedBoostedStatus.url || compactedBoostedStatus.id,

      actorId: compactedBoostedStatus.attributedTo,

      type: compactedBoostedStatus.type as StatusType,
      text: compactedBoostedStatus.content,
      summary: compactedBoostedStatus.summary || '',

      to: Array.isArray(boostedStatus.to)
        ? boostedStatus.to
        : [boostedStatus.to].filter((item) => item),
      cc: Array.isArray(boostedStatus.cc)
        ? boostedStatus.cc
        : [boostedStatus.cc].filter((item) => item),

      reply: compactedBoostedStatus.inReplyTo || '',
      createdAt: new Date(compactedBoostedStatus.published).getTime()
    })
  }

  console.log(compactedBoostedStatus)
  console.log(compactedStatus)
}
