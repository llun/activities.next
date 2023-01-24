import { AnnounceStatus } from '../activities/actions/announceStatus'
import { Document } from '../activities/entities/document'
import { Note, getContent, getSummary } from '../activities/entities/note'
import { getISOTimeUTC } from '../time'
import { ActorProfile } from './actor'
import { Attachment, AttachmentData } from './attachment'
import { Tag, TagData } from './tag'

export enum StatusType {
  Note = 'Note',
  Announce = 'Announce'
}

interface StatusBase {
  id: string
  actorId: string
  actor: ActorProfile | null

  to: string[]
  cc: string[]

  createdAt: number
  updatedAt: number
}

export interface StatusNote extends StatusBase {
  type: StatusType.Note
  url: string
  text: string
  summary: string
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

export type StatusData = StatusNote | StatusAnnounce

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

  get createdAt() {
    return this.data.createdAt
  }

  get updatedAt() {
    return this.data.updatedAt
  }

  static fromNote(note: Note) {
    const attachments = (
      Array.isArray(note.attachment) ? note.attachment : [note.attachment]
    ).filter((item): item is Document => item.type === 'Document')

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

      originalStatus,

      createdAt: new Date(announce.published).getTime(),
      updatedAt: Date.now()
    })
  }

  toObject(): Note {
    const data =
      this.data.type === StatusType.Note ? this.data : this.data.originalStatus

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
    return this.data
  }
}
