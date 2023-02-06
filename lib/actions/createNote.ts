import crypto from 'crypto'

import { getPublicProfile, sendNote } from '../activities'
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
import { getMentions, linkifyText, paragraphText } from '../link'
import { Actor } from '../models/actor'
import { PostBoxAttachment } from '../models/attachment'
import { StatusType } from '../models/status'
import { Storage } from '../storage/types'
import { addStatusToTimelines } from '../timelines'
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

  const [, status] = await Promise.all([
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
  await addStatusToTimelines(storage, status)

  const attachments = getAttachments(note)
  const tags = getTags(note)
  await Promise.all([
    ...attachments.map(async (attachment) => {
      if (attachment.type !== 'Document') return
      return storage.createAttachment({
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

  const createdStatus = await storage.createNote({
    id: statusId,
    url: `https://${
      currentActor.domain
    }/${currentActor.getMention()}/${postId}`,

    actorId: currentActor.id,

    text: paragraphText(await linkifyText(text)),
    summary: '',

    to: [ACTIVITY_STREAM_PUBLIC],
    cc: [currentActor.followersUrl, ...mentions.map((item) => item.href)],

    reply: replyStatus?.data.id || ''
  })

  await Promise.all([
    addStatusToTimelines(storage, createdStatus),
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

  const status = await storage.getStatus({ statusId })
  if (!status) return null

  const currentActorUrl = new URL(currentActor.id)
  const remoteActorsInbox = (
    await Promise.all(
      mentions
        .filter((item) => !item.href.startsWith(currentActorUrl.origin))
        .map((item) => item.href)
        .map(async (id) => {
          const actor = await storage.getActorFromId({ id })
          if (actor) return actor.sharedInboxUrl || actor.inboxUrl

          const profile = await getPublicProfile({ actorId: id })
          if (profile)
            return profile.endpoints.sharedInbox || profile.endpoints.inbox
          return null
        })
    )
  ).filter((item): item is string => item !== null)

  const followersInbox = await storage.getFollowersInbox({
    targetActorId: currentActor.id
  })

  const inboxes = Array.from(new Set([...remoteActorsInbox, ...followersInbox]))
  await Promise.all(
    inboxes.map((inbox) => {
      return sendNote({
        currentActor,
        inbox,
        note: status.toObject()
      })
    })
  )

  return status
}
