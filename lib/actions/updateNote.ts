import { sendUpdateNote } from '../activities'
import {
  Note,
  NoteEntity,
  getContent,
  getSummary
} from '../activities/entities/note'
import { compact } from '../jsonld'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT,
  ACTIVITY_STREAM_URL
} from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { StatusType } from '../models/status'
import { Storage } from '../storage/types'
import { getSpan } from '../trace'
import { formatText } from '../utils/text/formatText'

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
  if (!existingStatus || existingStatus.type !== StatusType.Note) {
    span.end()
    return note
  }

  const compactNote = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...note
  })) as Note
  if (compactNote.type !== NoteEntity) {
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
    status.type !== StatusType.Note ||
    status.actorId !== currentActor.id
  ) {
    span.end()
    return null
  }

  const updatedStatus = await storage.updateNote({
    statusId,
    summary,
    text: formatText(text)
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
  await Promise.all(
    Array.from(uniqueInboxes).map(async (inbox) => {
      try {
        await sendUpdateNote({
          currentActor,
          inbox,
          status: updatedStatus
        })
      } catch {
        console.error(`Fail to update note to ${inbox}`)
      }
    })
  )

  span.end()
  return updatedStatus
}
