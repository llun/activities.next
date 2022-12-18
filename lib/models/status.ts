import crypto from 'crypto'
import linkifyStr from 'linkify-string'

import { Mention } from '../activities/entities/mention'
import { Note } from '../activities/entities/note'
import { Question } from '../activities/entities/question'
import { getConfig } from '../config'
import '../linkify-mention'
import { Storage } from '../storage/types'
import { getISOTimeUTC } from '../time'
import { Actor, getAtUsernameFromId } from './actor'
import { Attachment } from './attachment'

// https://github.com/mastodon/mastodon/blob/a5394980f22e061ec7e4f6df3f3b571624f5ca7d/app/lib/activitypub/parser/status_parser.rb#L3
export interface Status {
  id: string
  url: string

  actorId: string

  type: 'Note' | 'Question'
  text: string
  summary: string | null

  // Activity to and cc model
  to: string[]
  cc: string[]

  // Internal recipients id
  localRecipients?: string[]

  reply: string | null

  createdAt: number
  updatedAt?: number
}

export const fromJson = (data: Note | Question): Status => ({
  id: data.id,
  url: data.url || data.id,

  actorId: data.attributedTo,

  type: data.type,
  text: data.content,
  summary: data.summary || '',

  to: Array.isArray(data.to) ? data.to : [data.to],
  cc: Array.isArray(data.cc) ? data.cc : [data.cc],

  reply: data.inReplyTo || null,

  createdAt: new Date(data.published).getTime(),
  updatedAt: Date.now()
})

interface CreateStatusParms {
  text: string
  currentActor: Actor
  replyStatus?: Status
  storage: Storage
}
interface CreateStatusReturns {
  status: Status
  mentions: Mention[]
}
export const createStatus = async ({
  currentActor,
  text,
  replyStatus,
  storage
}: CreateStatusParms): Promise<CreateStatusReturns> => {
  const currentTime = Date.now()
  const postId = crypto.randomUUID()
  const host = getConfig().host
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

  const followers = await storage.getLocalFollowersForActorId({
    targetActorId: currentActor.id
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
      localRecipients: [
        'as:Public',
        currentActor.id,
        ...followers.map((item) => item.actorId)
      ],
      reply: replyStatus?.id || null,
      createdAt: currentTime,
      updatedAt: currentTime
    },
    mentions
  }
}

interface ToObjectParams {
  status: Status
  mentions?: Mention[]
  replyStatus?: Status
  attachments?: Attachment[]
}
export const toObject = ({
  status,
  mentions = [],
  replyStatus,
  attachments = []
}: ToObjectParams): Note => {
  return {
    id: status.id,
    type: 'Note',
    summary: null,
    published: getISOTimeUTC(status.createdAt),
    url: status.url,
    attributedTo: status.actorId,
    // TODO: Fix cc and to in database
    to: status.to || null,
    cc: status.cc || null,
    inReplyTo: replyStatus?.id ?? null,
    content: status.text,
    attachment: attachments.map((attachment) => ({
      type: 'Document',
      mediaType: attachment.mediaType,
      url: attachment.url,
      width: attachment.width,
      height: attachment.height,
      name: attachment.name
    })),
    tag: [...mentions],
    replies: {
      id: `${status.id}/replies`,
      type: 'Collection',
      first: {
        type: 'CollectionPage',
        next: `${status.id}/replies?only_other_accounts=true&page=true`,
        partOf: `${status.id}/replies`,
        items: []
      }
    }
  }
}
