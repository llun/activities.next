import { AnnounceStatus } from '../activities/actions/announceStatus'
import { Document } from '../activities/entities/document'
import { Note, getContent, getSummary } from '../activities/entities/note'
import { Question, QuestionEntity } from '../activities/entities/question'
import { getISOTimeUTC } from '../time'
import { ActorProfile } from './actor'
import { Attachment, AttachmentData } from './attachment'
import { PollChoiceData } from './pollChoice'
import { Tag, TagData } from './tag'

export enum StatusType {
  Note = 'Note',
  Announce = 'Announce',
  Poll = 'Poll'
}

export interface Edited {
  text: string
  summary: string | null
  createdAt: number
}

interface StatusBase {
  id: string
  actorId: string
  actor: ActorProfile | null

  to: string[]
  cc: string[]

  edits: Edited[]

  createdAt: number
  updatedAt: number
}

export interface StatusNote extends StatusBase {
  type: StatusType.Note
  url: string
  text: string
  summary: string | null
  reply: string
  replies: StatusNote[]

  isActorAnnounced: boolean
  isActorLiked: boolean
  totalLikes: number

  attachments: AttachmentData[]
  tags: TagData[]
}

export interface StatusAnnounce extends StatusBase {
  type: StatusType.Announce

  originalStatus: StatusNote
}

export interface StatusPoll extends StatusBase {
  type: StatusType.Poll
  url: string
  text: string
  summary: string | null
  reply: string
  replies: StatusNote[]

  isActorAnnounced: boolean
  isActorLiked: boolean
  totalLikes: number

  tags: TagData[]
  choices: PollChoiceData[]

  endAt: number
}

export type StatusData = StatusNote | StatusAnnounce | StatusPoll

export class Status {
  readonly data: StatusData

  constructor(params: StatusData) {
    this.data = params
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
    if (this.data.type === StatusType.Note) return this.data.reply
    return null
  }

  get url() {
    if (this.data.type === StatusType.Note) return this.data.url
    return null
  }

  get content() {
    if (this.data.type === StatusType.Note) return this.data.text
    return null
  }

  get attachments() {
    if (this.data.type === StatusType.Note) return this.data.attachments
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

      type: StatusType.Note,

      text: getContent(note),
      summary: getSummary(note),

      to: Array.isArray(note.to) ? note.to : [note.to],
      cc: Array.isArray(note.cc) ? note.cc : [note.cc],
      edits: [],

      reply: note.inReplyTo || '',
      replies: [],

      attachments: attachments.map((attachment) => ({
        id: attachment.url,
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

      type: StatusType.Announce,

      to: Array.isArray(announce.to) ? announce.to : [announce.to],
      cc: Array.isArray(announce.cc) ? announce.cc : [announce.cc],
      edits: [],

      originalStatus,

      createdAt: new Date(announce.published).getTime(),
      updatedAt: Date.now()
    })
  }

  toObject(): Note | Question {
    if (this.data.type === StatusType.Poll) {
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
      this.data.type === StatusType.Announce
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

  toNote() {
    if (this.data.type !== StatusType.Note) return null

    const data = this.data
    const note: Note = {
      id: data.id,
      type: data.type,
      summary: data.summary,
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
        items: data.replies
          .map((reply) => {
            const status = new Status(reply)
            return status.toNote()
          })
          .filter((item): item is Note => item !== null)
      }
    }
    return note
  }

  toJson(): StatusData {
    return this.data
  }
}
