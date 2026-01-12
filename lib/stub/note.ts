import { Note } from '@llun/activities.schema'
import crypto from 'crypto'

import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { Document } from '../activities/entities/document'
import { TEST_DOMAIN } from './const'
import { ACTOR1_ID, seedActor1 } from './seed/actor1'

export const stubNoteId = (id = crypto.randomBytes(8).toString('hex')) =>
  `https://${TEST_DOMAIN}/users/${seedActor1.username}/statuses/${id}`

interface MockNoteParams {
  content: string | string[]
  contentMap?: { [key: string]: string } | string[]
  published?: number
  id?: string
  url?: string
  from?: string
  to?: string[]
  cc?: string[]
  inReplyTo?: string | null
  documents?: Document[]
  conversation?: string
  summary?: string | null
  sensitive?: boolean | null
  tags?: Note['tag']
  likesTotalItems?: number
  sharesTotalItems?: number
  repliesItems?: Note[]

  withContext?: boolean
}
export const MockMastodonActivityPubNote = ({
  id = stubNoteId(),
  published = Date.now(),
  content,
  contentMap,
  from = ACTOR1_ID,
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [],
  inReplyTo = null,
  documents = [],
  conversation,
  summary = '',
  sensitive = false,
  tags = [],
  likesTotalItems = 0,
  sharesTotalItems = 1,
  repliesItems = [],

  withContext
}: MockNoteParams) =>
  ({
    ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
    id,
    type: 'Note',
    summary,
    published: getISOTimeUTC(published),
    url: id,
    attributedTo: from,
    to,
    cc,
    sensitive,
    atomUri: id,
    inReplyTo,
    inReplyToAtomUri: inReplyTo,
    conversation:
      conversation ??
      `tag:${TEST_DOMAIN},${Date.now()}:objectId=${crypto.randomUUID()}:objectType=Conversation`,
    content,
    contentMap: contentMap ?? { en: content },
    attachment: documents,
    tag: tags,
    replies: {
      id: `${id}/replies`,
      type: 'Collection',
      first: {
        type: 'CollectionPage',
        next: `${id}/replies?only_other_accounts=true\u0026page=true`,
        partOf: `${id}/replies`,
        items: repliesItems
      }
    },
    likes: {
      id: `${id}/likes`,
      type: 'Collection',
      totalItems: likesTotalItems
    },
    shares: {
      id: `${id}/shares`,
      type: 'Collection',
      totalItems: sharesTotalItems
    }
  }) as Note

export const MockLitepubNote = ({
  id = stubNoteId(),
  published = Date.now(),
  content,
  from = ACTOR1_ID,
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [],
  inReplyTo = null,
  documents,
  conversation,
  summary = '',
  sensitive = null,
  tags = [],

  withContext
}: MockNoteParams) =>
  ({
    ...(withContext
      ? {
          '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://miraiverse.xyz/schemas/litepub-0.1.jsonld',
            { '@language': 'und' }
          ]
        }
      : null),
    actor: from,
    attachment: documents,
    attributedTo: from,
    cc,
    url: id,
    content,
    context:
      conversation ??
      'tag:mtd.bashell.com,2023-01-10:objectId=43759:objectType=Conversation',
    conversation:
      conversation ??
      'tag:mtd.bashell.com,2023-01-10:objectId=43759:objectType=Conversation',
    id,
    inReplyTo,
    published: getISOTimeUTC(published),
    sensitive,
    source: {
      content,
      mediaType: 'text/plain'
    },
    summary,
    tag: tags,
    to,
    type: 'Note'
  }) as Note
