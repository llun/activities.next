import { z } from 'zod'

import { AnnounceStatus } from '../activities/actions/announceStatus'
import { Document } from '../activities/entities/document'
import { Note, getContent, getSummary } from '../activities/entities/note'
import { Question, QuestionEntity } from '../activities/entities/question'
import { getISOTimeUTC } from '../time'
import { ActorProfile } from './actor'
import { Attachment, AttachmentData } from './attachment'
import { PollChoiceData } from './pollChoice'
import { Tag, TagData } from './tag'

export const StatusType = z.enum(['Note', 'Announce', 'Poll'])
export type StatusType = z.infer<typeof StatusType>

export const Edited = z.object({
  text: z.string(),
  summary: z.string().nullable(),
  createdAt: z.number()
})

export type Edited = z.infer<typeof Edited>

const StatusBase = z
  .object({
    id: z.string(),
    actorId: z.string(),
    actor: ActorProfile.nullable(),

    to: z.string().array(),
    cc: z.string().array(),

    edits: Edited.array(),

    createdAt: z.number(),
    updatedAt: z.number()
  })
  .passthrough()

type StatusBase = z.infer<typeof StatusBase>

export const StatusNote = StatusBase.extend({
  type: z.literal(StatusType.enum.Note),
  url: z.string(),
  text: z.string(),
  summary: z.string().nullable(),
  reply: z.string(),
  replies: StatusBase.array(),

  isActorAnnounced: z.boolean(),
  isActorLiked: z.boolean(),
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
  summary: z.string().nullable(),
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

export const StatusData = z.union([StatusNote, StatusAnnounce, StatusPoll])
export type StatusData = z.infer<typeof StatusData>

export const EditableStatusData = z.union([StatusNote, StatusPoll])
export type EditableStatusData = z.infer<typeof EditableStatusData>

export class Status {
  readonly data: StatusData

  constructor(params: StatusData) {
    this.data = StatusData.parse(params)
  }

  get id() {
    return this.data.id
  }

  get actorId() {
    return this.data.actorId
  }

  get actor() {
    return this.data.actor
  }

  get type() {
    return this.data.type
  }

  get to() {
    return this.data.to
  }

  get cc() {
    return this.data.cc
  }

  get reply() {
    if (this.data.type === StatusType.enum.Note) return this.data.reply
    return null
  }

  get url() {
    if (this.data.type === StatusType.enum.Note) return this.data.url
    return null
  }

  get content() {
    if (this.data.type === StatusType.enum.Note) return this.data.text
    return null
  }

  get attachments() {
    if (this.data.type === StatusType.enum.Note) return this.data.attachments
    return []
  }

  get createdAt() {
    return this.data.createdAt
  }

  get updatedAt() {
    return this.data.updatedAt
  }

  static fromNote(note: Note) {
    const attachments = (
      Array.isArray(note.attachment) ? note.attachment : [note.attachment]
    ).filter((item): item is Document => item?.type === 'Document')

    return new Status({
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

        createdAt: Date.now(),
        updatedAt: Date.now()
      })),
      tags: [],

      isActorAnnounced: false,
      isActorLiked: false,
      totalLikes: 0,

      createdAt: new Date(note.published).getTime(),
      updatedAt: Date.now()
    })
  }

  static fromAnnoucne(announce: AnnounceStatus, originalStatus: StatusNote) {
    return new Status({
      id: announce.id,

      actorId: announce.actor,
      actor: null,

      type: StatusType.enum.Announce,

      to: Array.isArray(announce.to) ? announce.to : [announce.to],
      cc: Array.isArray(announce.cc) ? announce.cc : [announce.cc],
      edits: [],

      originalStatus,

      createdAt: new Date(announce.published).getTime(),
      updatedAt: Date.now()
    })
  }

  toObject(): Note | Question {
    if (this.data.type === StatusType.enum.Poll) {
      const data = this.data
      return {
        id: data.id,
        type: QuestionEntity,
        summary: data.summary || null,
        published: getISOTimeUTC(data.createdAt),
        url: data.url,
        attributedTo: data.actorId,
        to: data.to,
        cc: data.cc,
        inReplyTo: data.reply || null,
        content: data.text,
        tag: data.tags.map((tag) => new Tag(tag).toObject()),
        endTime: getISOTimeUTC(data.endAt),
        oneOf: [],
        replies: {
          id: `${data.id}/replies`,
          type: 'Collection',
          totalItems: data.replies.length,
          items: data.replies.map((reply) => {
            const status = new Status(reply)
            return status.toObject()
          })
        }
      } as Question
    }

    const data =
      this.data.type === StatusType.enum.Announce
        ? this.data.originalStatus
        : this.data

    return {
      id: data.id,
      type: data.type,
      summary: data.summary || null,
      published: getISOTimeUTC(data.createdAt),
      url: data.url,
      attributedTo: data.actorId,
      to: data.to,
      cc: data.cc,
      inReplyTo: data.reply || null,
      content: data.text,
      attachment: data.attachments.map((attachment) =>
        new Attachment(attachment).toObject()
      ),
      tag: data.tags.map((tag) => new Tag(tag).toObject()),
      replies: {
        id: `${data.id}/replies`,
        type: 'Collection',
        totalItems: data.replies.length,
        items: data.replies.map((reply) => {
          const status = new Status(reply)
          return status.toObject()
        })
      }
    } as Note
  }

  toJson(): StatusData {
    // TODO: Find a better way to clean the data
    return JSON.parse(JSON.stringify(this.data))
  }
}
