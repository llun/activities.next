import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT
} from '@/lib/utils/jsonld/activitystream'

import { sendUpdateNote } from '../activities'
import { Actor } from '../models/actor'
import { StatusType } from '../models/status'
import { Storage } from '../storage/types'
import { logger } from '../utils/logger'
import { getSpan } from '../utils/trace'

interface UpdateNoteFromUserInput {
  statusId: string
  currentActor: Actor
  text: string
  summary?: string
  storage: Storage
}

export const updateNoteFromUserInput = async ({
  statusId,
  currentActor,
  text,
  summary,
  storage
}: UpdateNoteFromUserInput) => {
  const span = getSpan('actions', 'updateNoteFromUser', { statusId })
  const status = await storage.getStatus({ statusId })
  if (
    !status ||
    status.type !== StatusType.enum.Note ||
    status.actorId !== currentActor.id
  ) {
    span.end()
    return null
  }

  const updatedStatus = await storage.updateNote({
    statusId,
    summary,
    text
  })
  if (!updatedStatus) {
    span.end()
    return null
  }

  const inboxes = []
  if (
    updatedStatus.to.includes(ACTIVITY_STREAM_PUBLIC) ||
    updatedStatus.to.includes(ACTIVITY_STREAM_PUBLIC_COMACT) ||
    updatedStatus.cc.includes(ACTIVITY_STREAM_PUBLIC) ||
    updatedStatus.cc.includes(ACTIVITY_STREAM_PUBLIC_COMACT)
  ) {
    const followersInbox = await storage.getFollowersInbox({
      targetActorId: currentActor.id
    })
    inboxes.push(...followersInbox)
  }

  const toInboxes = (
    await Promise.all(
      [...updatedStatus.to, ...updatedStatus.cc]
        .filter(
          (item) =>
            item !== ACTIVITY_STREAM_PUBLIC &&
            item !== ACTIVITY_STREAM_PUBLIC_COMACT
        )
        .map(async (item) => storage.getActorFromId({ id: item }))
    )
  )
    .filter((actor): actor is Actor => Boolean(actor))
    .map((actor) => actor.sharedInboxUrl || actor.inboxUrl)
  inboxes.push(...toInboxes)

  const uniqueInboxes = new Set(inboxes)
  await Promise.all([
    ...Array.from(uniqueInboxes).map(async (inbox) => {
      try {
        await sendUpdateNote({
          currentActor,
          inbox,
          status: updatedStatus
        })
      } catch {
        logger.error({ inbox }, `Fail to update note`)
      }
    })
  ])

  span.end()
  return updatedStatus
}
