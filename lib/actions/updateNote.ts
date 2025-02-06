import { sendUpdateNote } from '@/lib/activities'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'
import { StatusType } from '@/lib/models/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT
} from '@/lib/utils/jsonld/activitystream'
import { logger } from '@/lib/utils/logger'
import { getSpan } from '@/lib/utils/trace'

interface UpdateNoteFromUserInput {
  statusId: string
  currentActor: Actor
  text: string
  summary?: string
  database: Database
}

export const updateNoteFromUserInput = async ({
  statusId,
  currentActor,
  text,
  summary,
  database
}: UpdateNoteFromUserInput) => {
  const span = getSpan('actions', 'updateNoteFromUser', { statusId })
  const status = await database.getStatus({ statusId })
  if (
    !status ||
    status.type !== StatusType.enum.Note ||
    status.actorId !== currentActor.id
  ) {
    span.end()
    return null
  }

  const updatedStatus = await database.updateNote({
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
    const followersInbox = await database.getFollowersInbox({
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
        .map(async (item) => database.getActorFromId({ id: item }))
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
