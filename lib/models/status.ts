import linkifyStr from 'linkify-string'

import { AnnounceStatus } from '../activities/actions/announceStatus'
import { Note } from '../activities/entities/note'
import '../linkify-mention'
import { getISOTimeUTC } from '../time'
import { Profile } from './actor'
import { Attachment, AttachmentData } from './attachment'
import { Tag, TagData } from './tag'

export enum StatusType {
  Note = 'Note',
  Announce = 'Announce'
}

interface StatusBase {
  id: string
  actorId: string
  actor: Profile | null

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

  static fromNote(note: Note) {
    return new Status({
      id: note.id,
      url: note.url || note.id,

      actorId: note.attributedTo,
      actor: null,

      type: StatusType.Note,

      text: note.content,
      summary: note.summary || '',

      to: Array.isArray(note.to) ? note.to : [note.to],
      cc: Array.isArray(note.cc) ? note.cc : [note.cc],

      reply: note.inReplyTo || '',
      replies: [],

      attachments: [],
      tags: [],

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

  static linkfyText(text: string) {
    return linkifyStr(text.trim(), {
      rel: 'nofollow noopener noreferrer',
      target: '_blank',
      truncate: 42,
      render: {
        mention: ({ attributes, content }) => {
          const { href } = attributes
          const [user] = content.slice(1).split('@')
          return `<span class="h-card"><a href="https:${href}" class="u-url mention">@<span>${user}</span></a></span>`
        }
      }
    })
  }

  static paragraphText(text: string) {
    const texts = text.trim().split('\n')
    const groups: string[][] = []
    for (const text of texts) {
      let lastGroup: string[] = groups[groups.length - 1]
      if (!lastGroup) {
        lastGroup = []
        groups.push(lastGroup)
      }

      const lastItem = lastGroup[lastGroup.length - 1]
      if (lastItem === undefined) {
        lastGroup.push(text)
        continue
      }

      if (text.length > 0) {
        if (lastItem.length > 0) {
          lastGroup.push(text)
          continue
        }

        lastGroup = []
        groups.push(lastGroup)
        lastGroup.push(text)
        continue
      }

      if (lastItem.length === 0) {
        lastGroup.push(text)
        continue
      }

      lastGroup = []
      groups.push(lastGroup)
      lastGroup.push(text)
    }

    const messages = groups
      .map((group) => {
        const item = group[group.length - 1]
        if (item.length === 0 && group.length === 1) {
          return ''
        }
        if (item.length === 0 && group.length > 1) {
          return group
            .slice(1)
            .map(() => '<br />')
            .join('\n')
        }
        return `<p>${group.join('<br />')}</p>`
      })
      .filter((item) => item.length > 0)

    return messages.join('\n')
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
