import { ENTITY_TYPE_QUESTION, Note, Question } from '@llun/activities.schema'
import { z } from 'zod'

import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { AnnounceStatus } from '../activities/actions/announceStatus'
import { Document } from '../activities/entities/document'
import { getContent, getSummary } from '../activities/entities/note'
import { ActorProfile } from './actor'
import { Attachment, AttachmentData } from './attachment'
import { PollChoiceData } from './pollChoice'
import { Tag, TagData } from './tag'

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

  createdAt: z.number(),
  updatedAt: z.number()
})

export const StatusNote = StatusBase.extend({
  type: z.literal(StatusType.enum.Note),
  url: z.string(),
  text: z.string(),
  summary: z.string().nullable().optional(),
  reply: z.string(),
  replies: StatusBase.array(),

  isActorAnnounced: z.boolean(),
  isActorLiked: z.boolean(),
  isLocalActor: z.boolean(),
  totalLikes: z.number(),

  attachments: AttachmentData.array(),
  tags: TagData.array()
})

export type StatusNote = z.infer<typeof StatusNote>

export const StatusAnnounce = StatusBase.extend({
  type: z.literal(StatusType.enum.Announce),
  originalStatus: StatusNote
})

export type StatusAnnounce = z.infer<typeof StatusAnnounce>

export const StatusPoll = StatusBase.extend({
  type: z.literal(StatusType.enum.Poll),
  url: z.string(),
  text: z.string(),
  summary: z.string().nullable().optional(),
  reply: z.string(),
  replies: StatusBase.array(),

  isActorAnnounced: z.boolean(),
  isActorLiked: z.boolean(),
  totalLikes: z.number(),

  tags: TagData.array(),
  choices: PollChoiceData.array(),

  endAt: z.number()
})

export type StatusPoll = z.infer<typeof StatusPoll>

export const Status = z.union([StatusNote, StatusAnnounce, StatusPoll])
export type Status = z.infer<typeof Status>

export const EditableStatus = z.union([StatusNote, StatusPoll])
export type EditableStatus = z.infer<typeof EditableStatus>

export const fromNote = (note: Note): StatusNote => {
  const currentTime = Date.now()
  const attachments = (
    Array.isArray(note.attachment) ? note.attachment : [note.attachment]
  ).filter((item): item is Document => item?.type === 'Document')

  return StatusNote.parse({
    id: note.id,
    url: note.url || note.id,

    actorId: note.attributedTo,
    actor: null,

    type: StatusType.enum.Note,

    text: getContent(note),
    summary: getSummary(note),

    to: Array.isArray(note.to) ? note.to : [note.to],
    cc: Array.isArray(note.cc) ? note.cc : [note.cc],
    edits: [],

    reply: note.inReplyTo || '',
    replies: [],

    attachments: attachments.map((attachment) => ({
      id: attachment.url,
      actorId: note.attributedTo,
      statusId: note.id,
      type: 'Document',
      mediaType: attachment.mediaType,
      url: attachment.url,
      name: attachment.name ?? '',

      createdAt: currentTime,
      updatedAt: currentTime
    })),
    tags: [],

    isActorAnnounced: false,
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

    to: Array.isArray(announce.to) ? announce.to : [announce.to],
    cc: Array.isArray(announce.cc) ? announce.cc : [announce.cc],
    edits: [],

    originalStatus,

    createdAt: new Date(announce.published).getTime(),
    updatedAt: currentTime
  })
}

export const toMastodonObject = (status: Status): Note | Question => {
  if (status.type === StatusType.enum.Poll) {
    return Question.parse({
      id: status.id,
      type: ENTITY_TYPE_QUESTION,
      summary: status.summary || null,

      url: status.url,
      attributedTo: status.actorId,
      to: status.to,
      cc: status.cc,
      inReplyTo: status.reply || null,
      content: status.text,
      tag: status.tags.map((tag) => new Tag(tag).toObject()),

      oneOf: [],
      replies: {
        id: `${status.id}/replies`,
        type: 'Collection',
        totalItems: status.replies.length,
        items: status.replies.map((reply) =>
          toMastodonObject(Status.parse(reply))
        )
      },

      published: getISOTimeUTC(status.createdAt),
      endTime: getISOTimeUTC(status.endAt),
      ...(status.updatedAt
        ? { updated: getISOTimeUTC(status.updatedAt) }
        : null)
    })
  }

  const originalStatus =
    status.type === StatusType.enum.Announce ? status.originalStatus : status
  return Note.parse({
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
      new Attachment(attachment).toObject()
    ),
    tag: originalStatus.tags.map((tag) => new Tag(tag).toObject()),
    replies: {
      id: `${originalStatus.id}/replies`,
      type: 'Collection',
      totalItems: originalStatus.replies.length,
      items: originalStatus.replies.map((reply) =>
        toMastodonObject(Status.parse(reply))
      )
    },

    published: getISOTimeUTC(originalStatus.createdAt),
    ...(originalStatus.updatedAt
      ? { updated: getISOTimeUTC(originalStatus.updatedAt) }
      : null)
  })
}
