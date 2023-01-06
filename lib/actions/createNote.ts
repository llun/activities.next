import crypto from 'crypto'
import * as linkify from 'linkifyjs'

import { getPersonFromHandle } from '../activities'
import { Mention } from '../activities/entities/mention'
import { Note, getAttachments, getTags } from '../activities/entities/note'
import { getConfig } from '../config'
import { compact } from '../jsonld'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '../jsonld/activitystream'
import { Actor, getAtUsernameFromId } from '../models/actor'
import { PostBoxAttachment } from '../models/attachment'
import { Status, StatusType } from '../models/status'
import { Storage } from '../storage/types'

interface CreateNoteParams {
  note: Note
  storage: Storage
}
export const createNote = async ({
  note,
  storage
}: CreateNoteParams): Promise<Note | null> => {
  const existingStatus = await storage.getStatus({ statusId: note.id })
  if (existingStatus) {
    return note
  }

  const compactNote = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...note
  })) as Note
  if (compactNote.type !== StatusType.Note) {
    return null
  }

  await storage.createNote({
    id: compactNote.id,
    url: compactNote.url || compactNote.id,

    actorId: compactNote.attributedTo,

    text: compactNote.content,
    summary: compactNote.summary || '',

    to: Array.isArray(note.to) ? note.to : [note.to].filter((item) => item),
    cc: Array.isArray(note.cc) ? note.cc : [note.cc].filter((item) => item),

    reply: compactNote.inReplyTo || '',
    createdAt: new Date(compactNote.published).getTime()
  })

  const attachments = getAttachments(note)
  const tags = getTags(note)
  await Promise.all([
    ...attachments.map(async (attachment) => {
      if (attachment.type !== 'Document') return

      await storage.createAttachment({
        statusId: compactNote.id,
        mediaType: attachment.mediaType,
        height: attachment.height,
        width: attachment.width,
        name: attachment.name || '',
        url: attachment.url
      })
    }),
    ...tags.map((item) =>
      storage.createTag({
        statusId: compactNote.id,
        name: item.name,
        value: item.href
      })
    )
  ])
  return note
}

export const getMentions = async (
  text: string,
  currentActor: Actor
): Promise<Mention[]> => {
  const mentions = await Promise.all(
    linkify
      .find(text)
      .filter((item) => item.type === 'mention')
      .map((item) => [item.value, item.value.slice(1).split('@')].flat())
      .map(async ([value, user, host]) => {
        try {
          const userHost = host ?? currentActor.domain
          const person = await getPersonFromHandle(`${user}@${userHost}`)
          if (!person) return null
          return {
            type: 'Mention',
            href: person?.id ?? `https://${host}/users/${user}`,
            name: value
          }
        } catch {
          return null
        }
      })
  )
  return mentions.filter((item): item is Mention => item !== null)
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
  const statusId = `${currentActor.id}/statuses/${postId}`

  await storage.createNote({
    id: statusId,
    url: `https://${host}/${getAtUsernameFromId(currentActor.id)}/${postId}`,

    actorId: currentActor.id,

    text: Status.paragraphText(Status.linkfyText(text)),
    summary: '',

    to: [
      ACTIVITY_STREAM_PUBLIC,
      ...(replyStatus ? [replyStatus?.data.actorId] : [])
    ],
    // TODO: Get this from actor profile
    cc: [`${currentActor.id}/followers`],

    reply: replyStatus?.data.id || ''
  })

  const mentions = await getMentions(text, currentActor)
  await Promise.all([
    ...attachments.map((attachment) =>
      storage.createAttachment({
        statusId,
        mediaType: attachment.mediaType,
        url: attachment.url,
        width: attachment.width,
        height: attachment.height,
        name: attachment.name
      })
    ),
    ...mentions.map((mention) =>
      storage.createTag({
        statusId,
        name: mention.name,
        value: mention.href
      })
    )
  ])
  return storage.getStatus({ statusId })
}
