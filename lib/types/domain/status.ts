import identity from 'lodash/identity'
import { z } from 'zod'

import { AnnounceStatus } from '@/lib/activities/actions/announceStatus'
import {
  APArticleContent,
  APImageContent,
  APNote,
  APPageContent,
  APQuestion,
  APVideoContent,
  ENTITY_TYPE_QUESTION
} from '@/lib/types/activitypub'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { ActorProfile } from './actor'
import { Attachment, getDocumentFromAttachment } from './attachment'
import { PollChoice } from './pollChoice'
import { Tag, getMentionFromTag } from './tag'

// Document type for fromNote transformation
interface Document {
  type: 'Document'
  mediaType: string
  url: string
  name?: string | null
}

// Use APNote type
type Note = z.infer<typeof APNote>
type Question = z.infer<typeof APQuestion>

// Utility functions for extracting data from ActivityPub notes
// (moved from lib/activities/entities/note.ts)
// BaseNote is a union of all content types that can be processed
export type BaseNote =
  | Note
  | z.infer<typeof APImageContent>
  | z.infer<typeof APPageContent>
  | z.infer<typeof APArticleContent>
  | z.infer<typeof APVideoContent>

export const getUrl = (
  url: string | unknown | unknown[]
): string | undefined => {
  if (Array.isArray(url)) {
    const first = url[0]
    if (typeof first === 'string') return first
    return (first as { href?: string })?.href
  }
  if (typeof url === 'string') return url
  return (url as { href?: string })?.href
}

export const getReply = (reply: string | unknown): string | undefined => {
  if (typeof reply === 'string') return reply
  return (reply as { id?: string })?.id
}

export const getContent = (object: BaseNote) => {
  if (object.content) {
    if (Array.isArray(object.content)) {
      return object.content[0]
    }
    return object.content
  }

  if (object.contentMap) {
    if (Array.isArray(object.contentMap)) {
      return object.contentMap[0]
    }

    const keys = Object.keys(object.contentMap)
    if (keys.length === 0) return ''

    const key = Object.keys(object.contentMap)[0]
    return object.contentMap[key]
  }
  return ''
}

export const getSummary = (object: BaseNote) => {
  if (object.summary) return object.summary
  if (object.summaryMap) {
    const keys = Object.keys(object.summaryMap)
    if (keys.length === 0) return ''

    const key = Object.keys(object.summaryMap)[0]
    return object.summaryMap[key]
  }
  return ''
}

export const getAttachments = (object: BaseNote) => {
  const attachments = []
  if (object.attachment) {
    if (Array.isArray(object.attachment)) {
      attachments.push(...object.attachment)
    } else {
      attachments.push(object.attachment)
    }
  }

  if (['Image', 'Video'].includes(object.type)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsafeObject = object as any
    const url = getUrl(unsafeObject.url)
    if (url) {
      attachments.push({
        type: 'Document',
        mediaType:
          unsafeObject.mediaType ||
          (object.type === 'Image' ? 'image/jpeg' : 'video/mp4'),
        url,
        name: unsafeObject.name,
        width: unsafeObject.width,
        height: unsafeObject.height,
        blurhash: unsafeObject.blurhash
      })
    }
  }
  return attachments
}

export const getTags = (object: BaseNote) => {
  if (!object.tag) return []
  if (Array.isArray(object.tag)) return object.tag
  return [object.tag]
}

export const StatusType = z.enum(['Note', 'Announce', 'Poll'])
export type StatusType = z.infer<typeof StatusType>

export const Edited = z.object({
  text: z.string(),
  summary: z.string().nullable().optional(),
  createdAt: z.number()
})

export type Edited = z.infer<typeof Edited>

const StatusBase = z.object({
  id: z.string(),
  actorId: z.string(),
  actor: ActorProfile.nullable(),

  to: z.string().array(),
  cc: z.string().array(),

  edits: Edited.array(),

  isLocalActor: z.boolean(),

  createdAt: z.number(),
  updatedAt: z.number()
})

export const StatusNote = StatusBase.extend({
  type: z.literal(StatusType.enum.Note),
  url: z.string(),
  text: z.string(),
  summary: z.string().nullable().optional(),
  reply: z.string(),
  replies: z.looseObject(StatusBase.shape).array(),

  actorAnnounceStatusId: z.string().nullable(),
  isActorLiked: z.boolean(),
  totalLikes: z.number(),

  attachments: Attachment.array(),
  tags: Tag.array()
})
export type StatusNote = z.infer<typeof StatusNote>

export const StatusPoll = StatusNote.extend({
  type: z.literal(StatusType.enum.Poll),
  choices: PollChoice.array(),
  endAt: z.number(),
  pollType: z.enum(['oneOf', 'anyOf']).default('oneOf'),
  voted: z.boolean().optional(),
  ownVotes: z.array(z.number()).optional()
})
export type StatusPoll = z.infer<typeof StatusPoll>

export const StatusAnnounce = StatusBase.extend({
  type: z.literal(StatusType.enum.Announce),
  originalStatus: z.union([StatusNote, StatusPoll])
})
export type StatusAnnounce = z.infer<typeof StatusAnnounce>

export const Status = z.union([StatusNote, StatusPoll, StatusAnnounce])
export type Status = z.infer<typeof Status>

export const EditableStatus = z.union([StatusNote, StatusPoll])
export type EditableStatus = z.infer<typeof EditableStatus>

// Helper to extract actor ID from attributedTo which can be a string or object
// Some ActivityPub implementations (like Friendica) return an object instead of a string
const getActorIdFromAttributedTo = (
  attributedTo: string | { id: string } | unknown
): string => {
  if (typeof attributedTo === 'string') {
    return attributedTo
  }
  if (
    typeof attributedTo === 'object' &&
    attributedTo !== null &&
    'id' in attributedTo &&
    typeof (attributedTo as { id: unknown }).id === 'string'
  ) {
    return (attributedTo as { id: string }).id
  }
  throw new Error(
    `Invalid attributedTo format: ${JSON.stringify(attributedTo)}`
  )
}

// Helper to extract URL from note.url which can be a string, array of strings,
// or array of Link objects (some ActivityPub implementations like Mastodon return arrays)
const getUrlFromNote = (note: Note): string => {
  const noteUrl = note.url as unknown
  if (typeof noteUrl === 'string') {
    return noteUrl
  }
  if (Array.isArray(noteUrl)) {
    const firstUrl = noteUrl.find(
      (item): item is string => typeof item === 'string'
    )
    if (firstUrl) {
      return firstUrl
    }
    const linkWithHref = noteUrl.find(
      (item): item is { href: string } =>
        typeof item === 'object' &&
        item !== null &&
        'href' in item &&
        typeof (item as { href: unknown }).href === 'string'
    )
    if (linkWithHref) {
      return linkWithHref.href
    }
  }
  return note.id
}

export const fromNote = (note: Note): StatusNote => {
  const currentTime = Date.now()
  const attachments = (
    Array.isArray(note.attachment) ? note.attachment : [note.attachment]
  ).filter((item): item is Document => item?.type === 'Document')

  const actorId = getActorIdFromAttributedTo(note.attributedTo)

  return StatusNote.parse({
    id: note.id,
    url: getUrlFromNote(note),

    actorId,
    actor: null,

    type: StatusType.enum.Note,

    text: getContent(note),
    summary: getSummary(note),

    to: Array.isArray(note.to) ? note.to : [note.to].filter(identity),
    cc: Array.isArray(note.cc) ? note.cc : [note.cc].filter(identity),
    edits: [],

    reply: getReply(note.inReplyTo) || '',
    replies: [],

    attachments: attachments.map((attachment) => ({
      id: attachment.url,
      actorId,
      statusId: note.id,
      type: 'Document',
      mediaType: attachment.mediaType,
      url: attachment.url,
      name: attachment.name ?? '',

      createdAt: currentTime,
      updatedAt: currentTime
    })),
    tags: [],

    actorAnnounceStatusId: null,
    isActorLiked: false,
    isLocalActor: false,
    totalLikes: 0,

    createdAt: new Date(note.published).getTime(),
    updatedAt: currentTime
  })
}

export const fromAnnoucne = (
  announce: AnnounceStatus,
  originalStatus: StatusNote
): StatusAnnounce => {
  const currentTime = Date.now()
  return StatusAnnounce.parse({
    id: announce.id,

    actorId: announce.actor,
    actor: null,

    type: StatusType.enum.Announce,

    to: Array.isArray(announce.to)
      ? announce.to
      : [announce.to].filter(identity),
    cc: Array.isArray(announce.cc)
      ? announce.cc
      : [announce.cc].filter(identity),
    edits: [],

    originalStatus,

    isLocalActor: false,

    createdAt: new Date(announce.published).getTime(),
    updatedAt: currentTime
  })
}

export const toActivityPubObject = (status: Status): Note | Question => {
  if (status.type === StatusType.enum.Poll) {
    return APQuestion.parse({
      id: status.id,
      type: ENTITY_TYPE_QUESTION,
      summary: status.summary || null,

      url: status.url,
      attributedTo: status.actorId,
      to: status.to,
      cc: status.cc,
      inReplyTo: status.reply || null,
      content: status.text,
      tag: status.tags.map((tag) => getMentionFromTag(tag)),

      oneOf: [],
      replies: {
        id: `${status.id}/replies`,
        type: 'Collection',
        totalItems: status.replies.length,
        items: status.replies.map((reply) =>
          toActivityPubObject(Status.parse(reply))
        )
      },

      published: getISOTimeUTC(status.createdAt),
      endTime: getISOTimeUTC(status.endAt),
      ...(status.updatedAt
        ? { updated: getISOTimeUTC(status.updatedAt) }
        : null)
    }) as Question
  }

  const originalStatus =
    status.type === StatusType.enum.Announce ? status.originalStatus : status
  return APNote.parse({
    id: originalStatus.id,
    type: originalStatus.type,
    summary: originalStatus.summary || null,
    url: originalStatus.url,
    attributedTo: originalStatus.actorId,
    to: originalStatus.to,
    cc: originalStatus.cc,
    inReplyTo: originalStatus.reply || null,
    content: originalStatus.text,
    attachment: originalStatus.attachments.map((attachment) =>
      getDocumentFromAttachment(attachment)
    ),
    tag: originalStatus.tags.map((tag) => getMentionFromTag(tag)),
    replies: {
      id: `${originalStatus.id}/replies`,
      type: 'Collection',
      totalItems: originalStatus.replies.length,
      items: originalStatus.replies.map((reply) =>
        toActivityPubObject(Status.parse(reply))
      )
    },

    published: getISOTimeUTC(originalStatus.createdAt),
    ...(originalStatus.updatedAt
      ? { updated: getISOTimeUTC(originalStatus.updatedAt) }
      : null)
  }) as Note
}
