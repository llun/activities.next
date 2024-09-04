import { Note } from '@llun/activities.schema'

import { compact } from '@/lib/utils/jsonld'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT,
  ACTIVITY_STREAM_URL
} from '@/lib/utils/jsonld/activitystream'

import { sendUpdateNote } from '../activities'
import { getContent, getSummary } from '../activities/entities/note'
import { Actor } from '../models/actor'
import { StatusType } from '../models/status'
import { Storage } from '../storage/types'
import { logger } from '../utils/logger'
import { getSpan } from '../utils/trace'

interface UpdateNoteParams {
  note: Note
  storage: Storage
}
export const updateNote = async ({ note, storage }: UpdateNoteParams) => {
  const span = getSpan('actions', 'updateNote', { status: note.id })
  const existingStatus = await storage.getStatus({
    statusId: note.id,
    withReplies: false
  })
  if (!existingStatus || existingStatus.type !== StatusType.enum.Note) {
    span.end()
    return note
  }

  const compactNote = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...note
  })) as Note
  if (compactNote.type !== 'Note') {
    span.end()
    return null
  }

  const text = getContent(compactNote)
  const summary = getSummary(compactNote)
  await storage.updateNote({
    statusId: compactNote.id,
    summary,
    text
  })
  span.end()
  return note
}

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
