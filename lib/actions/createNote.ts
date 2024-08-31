import { Note } from '@llun/activities.schema'
import crypto from 'crypto'
import { z } from 'zod'

import { addStatusToTimelines } from '@/lib/services/timelines'
import { compact } from '@/lib/utils/jsonld'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMACT,
  ACTIVITY_STREAM_URL
} from '@/lib/utils/jsonld/activitystream'

import { getPublicProfile, sendNote } from '../activities'
import { Mention } from '../activities/entities/mention'
import {
  getAttachments,
  getContent,
  getSummary,
  getTags
} from '../activities/entities/note'
import { Actor } from '../models/actor'
import { PostBoxAttachment } from '../models/attachment'
import { FollowStatus } from '../models/follow'
import { Status, StatusType } from '../models/status'
import { Storage } from '../storage/types'
import { getNoteFromStatusData } from '../utils/getNoteFromStatusData'
import { logger } from '../utils/logger'
import { UNFOLLOW_NETWORK_ERROR_CODES } from '../utils/response'
import { getMentions } from '../utils/text/getMentions'
import { getSpan } from '../utils/trace'
import { recordActorIfNeeded } from './utils'

export const CREATE_NOTE_JOB_NAME = 'CreateNoteJob'
export const CreateNoteJobMessage = z.object({
  name: z.literal(CREATE_NOTE_JOB_NAME),
  data: Note
})
export type CreateNoteJobMessage = z.infer<typeof CreateNoteJobMessage>

interface CreateNoteParams {
  note: Note
  storage: Storage
}
export const createNote = async ({
  note,
  storage
}: CreateNoteParams): Promise<Note | null> => {
  const span = getSpan('actions', 'createNote', { status: note.id })

  const existingStatus = await storage.getStatus({
    statusId: note.id,
    withReplies: false
  })
  if (existingStatus) {
    span.end()
    return note
  }

  const compactNote = (await compact({
    '@context': ACTIVITY_STREAM_URL,
    ...note
  })) as Note
  if (compactNote.type !== StatusType.enum.Note) {
    span.end()
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

  const attachments = getAttachments(note)
  const tags = getTags(note)

  await Promise.all([
    addStatusToTimelines(storage, status),
    ...attachments.map(async (attachment) => {
      if (attachment.type !== 'Document') return
      return storage.createAttachment({
        actorId: compactNote.attributedTo,
        statusId: compactNote.id,
        mediaType: attachment.mediaType,
        height: attachment.height,
        width: attachment.width,
        name: attachment.name || '',
        url: attachment.url
      })
    }),
    ...tags.map((item) => {
      if (item.type === 'Emoji') {
        return storage.createTag({
          statusId: compactNote.id,
          name: item.name,
          value: item.icon.url,
          type: 'emoji'
        })
      }
      return storage.createTag({
        statusId: compactNote.id,
        name: item.name || '',
        value: item.href,
        type: 'mention'
      })
    })
  ])

  span.end()
  return note
}

// TODO: Support status visibility public, unlist, followers only, mentions only
export const statusRecipientsTo = (actor: Actor, replyStatus?: Status) => {
  if (!replyStatus) {
    return [ACTIVITY_STREAM_PUBLIC]
  }

  if (replyStatus.to.includes(ACTIVITY_STREAM_PUBLIC)) {
    return [ACTIVITY_STREAM_PUBLIC, actor.followersUrl]
  }

  if (replyStatus.to.includes(ACTIVITY_STREAM_PUBLIC_COMACT)) {
    return [ACTIVITY_STREAM_PUBLIC, actor.followersUrl]
  }

  return [replyStatus.actorId]
}

export const statusRecipientsCC = (
  actor: Actor,
  mentions: Mention[],
  replyStatus?: Status
) => {
  if (!replyStatus) {
    return [actor.followersUrl, ...mentions.map((item) => item.href)]
  }

  if (replyStatus.cc.includes(ACTIVITY_STREAM_PUBLIC)) {
    return [actor.followersUrl, ...mentions.map((item) => item.href)]
  }

  if (replyStatus.cc.includes(ACTIVITY_STREAM_PUBLIC_COMACT)) {
    return [actor.followersUrl, ...mentions.map((item) => item.href)]
  }

  return mentions.map((item) => item.href)
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
  const span = getSpan('actions', 'createNoteFromUser', { text, replyNoteId })
  const replyStatus = replyNoteId
    ? await storage.getStatus({ statusId: replyNoteId, withReplies: false })
    : undefined

  const postId = crypto.randomUUID()
  const statusId = `${currentActor.id}/statuses/${postId}`
  const mentions = await getMentions({ text, currentActor, replyStatus })

  const to = statusRecipientsTo(currentActor, replyStatus)
  const cc = statusRecipientsCC(currentActor, mentions, replyStatus)

  const createdStatus = await storage.createNote({
    id: statusId,
    url: `https://${
      currentActor.domain
    }/${currentActor.getMention()}/${postId}`,

    actorId: currentActor.id,

    text,
    summary: null,

    to,
    cc,

    reply: replyStatus?.data.id || ''
  })

  await Promise.all([
    addStatusToTimelines(storage, createdStatus),
    ...attachments.map((attachment) =>
      storage.createAttachment({
        actorId: currentActor.id,
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
        name: mention.name || '',
        value: mention.href,
        type: 'mention'
      })
    )
  ])

  const status = await storage.getStatus({ statusId, withReplies: false })
  if (!status) {
    span.end()
    return null
  }

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

  const note = getNoteFromStatusData(status.data)
  if (!note) {
    span.end()
    return status
  }

  const inboxes = Array.from(new Set([...remoteActorsInbox, ...followersInbox]))
  await Promise.all([
    ...inboxes.map(async (inbox) => {
      try {
        await sendNote({
          currentActor,
          inbox,
          note: note as Note
        })
      } catch (e) {
        logger.error({ inbox }, `Fail to send note`)
        const nodeError = e as NodeJS.ErrnoException
        if (UNFOLLOW_NETWORK_ERROR_CODES.includes(nodeError.code ?? '')) {
          const follows = await storage.getLocalFollowsFromInboxUrl({
            followerInboxUrl: inbox,
            targetActorId: currentActor.id
          })
          await Promise.all(
            follows.map((follow) =>
              storage.updateFollowStatus({
                followId: follow.id,
                status: FollowStatus.enum.Rejected
              })
            )
          )
        }
      }
    })
  ])

  span.end()
  return status
}
