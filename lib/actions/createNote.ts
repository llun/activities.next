import crypto from 'crypto'
import * as linkify from 'linkifyjs'

import { getPersonFromHandle } from '../activities'
import { Mention } from '../activities/entities/mention'
import {
  Note,
  getAttachments,
  getContent,
  getSummary,
  getTags
} from '../activities/entities/note'
import { compact } from '../jsonld'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '../jsonld/activitystream'
import { Actor } from '../models/actor'
import { PostBoxAttachment } from '../models/attachment'
import { Status, StatusType } from '../models/status'
import { Storage } from '../storage/types'
import { recordActorIfNeeded } from './utils'

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

  const text = getContent(compactNote)
  const summary = getSummary(compactNote)

  await Promise.all([
    recordActorIfNeeded({ actorId: compactNote.attributedTo, storage }),
    storage.createNote({
      id: compactNote.id,
      url: compactNote.url || compactNote.id,

      actorId: compactNote.attributedTo,

      text,
      summary,

      to: Array.isArray(note.to) ? note.to : [note.to].filter((item) => item),
      cc: Array.isArray(note.cc) ? note.cc : [note.cc].filter((item) => item),

      reply: compactNote.inReplyTo || '',
      createdAt: new Date(compactNote.published).getTime()
    })
  ])

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

interface GetMentionsParams {
  text: string
  currentActor: Actor
  replyStatus?: Status
}
export const getMentions = async ({
  text,
  currentActor,
  replyStatus
}: GetMentionsParams): Promise<Mention[]> => {
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
          } as Mention
        } catch {
          return null
        }
      })
  )

  if (replyStatus) {
    const name = replyStatus.actor
      ? Actor.getMentionFromProfile(replyStatus.actor, true)
      : Actor.getMentionFromId(replyStatus.actorId, true)

    mentions.push({
      type: 'Mention',
      href: replyStatus.actorId,
      name
    })
  }

  const mentionsMap = mentions
    .filter((item): item is Mention => item !== null)
    .reduce((out, item) => {
      out[item.name] = item
      return out
    }, {} as { [key: string]: Mention })

  return Object.values(mentionsMap)
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
  const statusId = `${currentActor.id}/statuses/${postId}`
  const mentions = await getMentions({ text, currentActor, replyStatus })

  await storage.createNote({
    id: statusId,
    url: `https://${
      currentActor.domain
    }/${currentActor.getMention()}/${postId}`,

    actorId: currentActor.id,

    text: Status.paragraphText(Status.linkfyText(text)),
    summary: '',

    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [currentActor.followersUrl, ...mentions.map((item) => item.href)],

    reply: replyStatus?.data.id || ''
  })

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
