import crypto from 'crypto'
import * as jsonld from 'jsonld'
import linkifyStr from 'linkify-string'

import { Mention } from '../activities/entities/mention'
import { Note } from '../activities/entities/note'
import { Question } from '../activities/entities/question'
import { getConfig } from '../config'
import '../linkify-mention'
import { getISOTimeUTC } from '../time'
import { CONTEXT } from './activitystream.context'
import { Actor, getAtUsernameFromId } from './actor'

// https://github.com/mastodon/mastodon/blob/a5394980f22e061ec7e4f6df3f3b571624f5ca7d/app/lib/activitypub/parser/status_parser.rb#L3
export interface Status {
  id: string
  url: string

  actorId: string

  type: 'Note' | 'Question'
  text: string
  summary: string | null

  to: string[]
  cc: string[]

  reply: string

  createdAt: number
  updatedAt?: number
}

export const fromJson = (data: Note | Question): Status => ({
  id: data.id,
  url: data.url || data.id,

  actorId: data.attributedTo,

  type: data.type,
  text: data.content,
  summary: data.summary,

  to: data.to,
  cc: data.cc,

  reply: data.replies.id,

  createdAt: new Date(data.published).getTime(),
  updatedAt: Date.now()
})

interface CreateStatusParms {
  text: string
  currentActor: Actor
  replyStatus?: Status
}
interface CreateStatusReturns {
  status: Status
  mentions: Mention[]
}
export const createStatus = async ({
  currentActor,
  text,
  replyStatus
}: CreateStatusParms): Promise<CreateStatusReturns> => {
  const currentTime = Date.now()
  const postId = crypto.randomUUID()
  const host = getConfig().host
  const id = `${currentActor.id}/statuses/${postId}`
  const trimText = text.trim()

  const mentions: Mention[] = []
  const content = linkifyStr(trimText, {
    rel: 'nofollow noopener noreferrer',
    target: '_blank',
    truncate: 42,
    render: {
      mention: ({ attributes, content }) => {
        const { href } = attributes
        const [user, host] = content.slice(1).split('@')
        mentions.push({
          type: 'Mention',
          href: `https://${host}/users/${user}`,
          name: content
        })
        return `<span class="h-card"><a href="https:${href}" class="u-url mention">@<span>${user}</span></a></span>`
      }
    }
  })

  return {
    status: {
      id: `${currentActor.id}/statuses/${postId}`,
      url: `https://${host}/${getAtUsernameFromId(currentActor.id)}/${postId}`,
      actorId: currentActor.id,
      type: 'Note',
      text: `<p>${content}</p>`,
      summary: null,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: replyStatus
        ? [`${currentActor.id}/followers`, replyStatus.actorId]
        : [`${currentActor.id}/followers`],
      reply: `${id}/replies`,
      createdAt: currentTime
    },
    mentions
  }
}

interface ToObjectParams {
  status: Status
  mentions?: Mention[]
  replyStatus?: Status
}
export const toObject = ({
  status,
  mentions = [],
  replyStatus
}: ToObjectParams): Note => {
  return {
    id: status.id,
    type: 'Note',
    summary: null,
    published: getISOTimeUTC(status.createdAt),
    url: status.url,
    attributedTo: status.actorId,
    to: status.to,
    cc: status.cc,
    inReplyTo: replyStatus?.id ?? null,
    content: status.text,
    attachment: [],
    tag: [...mentions],
    replies: {
      id: status.reply,
      type: 'Collection',
      first: {
        type: 'CollectionPage',
        next: `${status.reply}?only_other_accounts=true&page=true`,
        partOf: replyStatus ? replyStatus.reply : status.reply,
        items: []
      }
    }
  }
}

export const compact = async ({ status }: ToObjectParams) => {
  const context = {
    '@context': 'https://www.w3.org/ns/activitystreams'
  }
  return jsonld.compact(
    {
      ...context,
      ...toObject({ status })
    },
    context
  )
}
