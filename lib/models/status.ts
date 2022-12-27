import linkifyStr from 'linkify-string'
import * as linkify from 'linkifyjs'

import { Note } from '../activities/entities/note'
import '../linkify-mention'
import { getISOTimeUTC } from '../time'
import { Attachment, AttachmentData } from './attachment'
import { Tag, TagData } from './tag'

export type StatusType = 'Note' | 'Question'
export interface StatusData {
  id: string
  url: string
  actorId: string
  type: StatusType
  text: string
  summary: string
  to: string[]
  cc: string[]

  reply: string
  attachments: AttachmentData[]
  tags: TagData[]

  createdAt: number
  updatedAt: number
}

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

      type: 'Note',

      text: note.content,
      summary: note.summary || '',

      to: Array.isArray(note.to) ? note.to : [note.to],
      cc: Array.isArray(note.cc) ? note.cc : [note.cc],

      reply: note.inReplyTo || '',

      attachments: [],
      tags: [],

      createdAt: new Date(note.published).getTime(),
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

  static getMentions(text: string) {
    return linkify
      .find(text)
      .filter((item) => item.type === 'mention')
      .map((item) => [item.value, item.value.slice(1).split('@')].flat())
      .map(([value, user, host]) => {
        // TODO: Get href from profile
        return {
          type: 'Mention',
          href: `https://${host}/users/${user}`,
          name: value
        }
      })
  }

  toObject() {
    const data = this.data
    return {
      id: data.id,
      type: data.type,
      summary: data.summary || null,
      published: getISOTimeUTC(data.createdAt),
      url: data.url,
      attributedTo: data.actorId,
      to: data.to,
      cc: data.cc,
      inReplyTo: this.data.reply || null,
      content: data.text,
      attachment: data.attachments.map((attachment) =>
        new Attachment(attachment).toObject()
      ),
      tag: data.tags.map((tag) => new Tag(tag).toObject()),
      replies: {
        id: `${data.id}/replies`,
        type: 'Collection',
        first: {
          type: 'CollectionPage',
          next: `${data.id}/replies?only_other_accounts=true&page=true`,
          partOf: `${data.id}/replies`,
          items: []
        }
      }
    } as Note
  }

  toJson(): StatusData {
    return this.data
  }
}
