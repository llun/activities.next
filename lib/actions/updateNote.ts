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
    span?.finish()
    return note
  }

  const compactNote = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...note
  })) as Note
  if (compactNote.type !== NoteEntity) {
    span?.finish()
    return null
  }

  const text = getContent(compactNote)
  const summary = getSummary(compactNote)
  await storage.updateNote({
    statusId: compactNote.id,
    summary,
    text
  })
  span?.finish()
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
    span?.finish()
    return null
  }

  const updatedNote = await storage.updateNote({ statusId, summary, text })
  if (!updatedNote) {
    span?.finish()
    return null
  }

  const inboxes = []
  if (
    updatedNote.to.includes(ACTIVITY_STREAM_PUBLIC) ||
    updatedNote.to.includes(ACTIVITY_STREAM_PUBLIC_COMACT) ||
    updatedNote.cc.includes(ACTIVITY_STREAM_PUBLIC) ||
    updatedNote.cc.includes(ACTIVITY_STREAM_PUBLIC_COMACT)
  ) {
    const followersInbox = await storage.getFollowersInbox({
      targetActorId: currentActor.id
    })
    inboxes.push(...followersInbox)
  }

  const toInboxes = (
    await Promise.all(
      [...updatedNote.to, ...updatedNote.cc]
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
          status
        })
      } catch {
        console.error(`Fail to update note to ${inbox}`)
      }
    })
  )

  span?.finish()
  return status
}
