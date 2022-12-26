import linkifyStr from 'linkify-string'
import * as linkify from 'linkifyjs'

import { Note } from '../activities/entities/note'
import '../linkify-mention'
import { getISOTimeUTC } from '../time'
import { Attachment } from './attachment'

export type StatusType = 'Note' | 'Question'

export class Status {
  readonly id: string
  readonly url: string
  readonly actorId: string
  readonly type: StatusType

  readonly text: string
  readonly summary: string

  readonly to: string[]
  readonly cc: string[]

  readonly localRecipients: string[]

  readonly reply: string

  readonly attachments: Attachment[]

  readonly createdAt: number
  readonly updatedAt: number

  constructor(params: {
    id: string
    url: string
    actorId: string
    type: StatusType
    text: string
    summary: string
    to: string[]
    cc: string[]

    localRecipients: string[]
    reply: string
    attachments: Attachment[]

    createdAt: number
    updatedAt: number
  }) {
    this.id = params.id
    this.url = params.url
    this.actorId = params.actorId
    this.type = params.type
    this.text = params.text
    this.summary = params.summary
    this.to = params.to
    this.cc = params.cc
    this.reply = params.reply
    this.localRecipients = params.localRecipients
    this.attachments = params.attachments
    this.createdAt = params.createdAt
    this.updatedAt = params.createdAt
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
      localRecipients: [],

      reply: note.inReplyTo || '',

      attachments: [],

      createdAt: new Date(note.published).getTime(),
      updatedAt: Date.now()
    })
  }

  static linkify(text: string) {
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

  getMentions() {
    return linkify
      .find(this.text)
      .filter((item) => item.type === 'mention')
      .map((item) => [item.value, item.value.slice(1).split('@')].flat())
      .map(([value, user, host]) => {
        return {
          type: 'Mention',
          href: `https://${host}/users/${user}`,
          name: value
        }
      })
  }

  toObject() {
    switch (this.type) {
      case 'Note': {
        return {
          id: this.id,
          type: 'Note',
          summary: this.summary || null,
          published: getISOTimeUTC(this.createdAt),
          url: this.url,
          attributedTo: this.actorId,
          to: this.to,
          cc: this.cc,
          inReplyTo: this?.reply || null,
          content: this.text,
          attachment: this.attachments.map((attachment) => ({
            type: 'Document',
            mediaType: attachment.mediaType,
            url: attachment.url,
            width: attachment.width,
            height: attachment.height,
            name: attachment.name
          })),
          tag: [...this.getMentions()],
          replies: {
            id: `${this.id}/replies`,
            type: 'Collection',
            first: {
              type: 'CollectionPage',
              next: `${this.id}/replies?only_other_accounts=true&page=true`,
              partOf: `${this.id}/replies`,
              items: []
            }
          }
        } as Note
      }
      default: {
        return undefined
      }
    }
  }
}
