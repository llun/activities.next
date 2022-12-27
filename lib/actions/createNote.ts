import crypto from 'crypto'

import { Note, getAttachments } from '../activities/entities/note'
import { getConfig } from '../config'
import { compact } from '../jsonld'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '../jsonld/activitystream'
import { Actor, getAtUsernameFromId } from '../models/actor'
import { PostBoxAttachment } from '../models/attachment'
import { Status } from '../models/status'
import { Storage } from '../storage/types'
import { deliverTo } from './utils'

interface CreateNoteParams {
  note: Note
  storage: Storage
}
export const createNote = async ({
  note,
  storage
}: CreateNoteParams): Promise<Note> => {
  const existingStatus = await storage.getStatus({ statusId: note.id })
  if (existingStatus) {
    return note
  }

  const compactNote = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...note
  })) as Note

  await storage.createStatus({
    id: compactNote.id,
    url: compactNote.url || compactNote.id,

    actorId: compactNote.attributedTo,

    type: compactNote.type,
    text: compactNote.content,
    summary: compactNote.summary || '',

    // Preserve URL here?
    to: Array.isArray(note.to) ? note.to : [note.to].filter((item) => item),
    cc: Array.isArray(note.cc) ? note.cc : [note.cc].filter((item) => item),
    localRecipients: await deliverTo({ note: compactNote, storage }),

    reply: compactNote.inReplyTo || '',
    createdAt: new Date(compactNote.published).getTime()
  })

  const attachments = getAttachments(note)
  if (attachments) {
    await Promise.all([
      attachments.map(async (attachment) => {
        if (attachment.type !== 'Document') return

        await storage.createAttachment({
          statusId: compactNote.id,
          mediaType: attachment.mediaType,
          height: attachment.height,
          width: attachment.width,
          name: attachment.name || '',
          url: attachment.url
        })
      })
    ])
  }
  return note
}

interface CreateNoteFromUserInputParams {
  text: string
  replyNoteId?: string
  currentActor: Actor
  attachments?: PostBoxAttachment[]
  storage: Storage
}
export const createNoteFromUserInput = async ({
  text,
  replyNoteId,
  currentActor,
  attachments = [],
  storage
}: CreateNoteFromUserInputParams) => {
  const replyStatus = replyNoteId
    ? await storage.getStatus({ statusId: replyNoteId })
    : undefined

  const postId = crypto.randomUUID()
  const host = getConfig().host
  const followers = await storage.getLocalFollowersForActorId({
    targetActorId: currentActor.id
  })
  const statusId = `${currentActor.id}/statuses/${postId}`

  await storage.createStatus({
    id: statusId,
    url: `https://${host}/${getAtUsernameFromId(currentActor.id)}/${postId}`,

    actorId: currentActor.id,

    type: 'Note',
    text: Status.linkify(text),
    summary: '',

    to: [ACTIVITY_STREAM_PUBLIC, ...(replyStatus ? [replyStatus.actorId] : [])],
    cc: [`${currentActor.id}/followers`],
    localRecipients: [
      'as:Public',
      currentActor.id,
      ...followers.map((item) => item.actorId)
    ],

    reply: replyStatus?.id || ''
  })
  await Promise.all(
    attachments.map((attachment) =>
      storage.createAttachment({
        statusId,
        mediaType: attachment.mediaType,
        url: attachment.url,
        width: attachment.width,
        height: attachment.height,
        name: attachment.name
      })
    )
  )
  return storage.getStatus({ statusId })
}
