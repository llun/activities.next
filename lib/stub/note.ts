import crypto from 'crypto'

import { Document } from '../activities/entities/document'
import { Note } from '../activities/entities/note'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '../jsonld/activitystream'
import { getISOTimeUTC } from '../time'
import { TEST_DOMAIN } from './const'
import { ACTOR1_ID, seedActor1 } from './seed/actor1'

export const stubNoteId = (id = crypto.randomBytes(8).toString('hex')) =>
  `https://${TEST_DOMAIN}/users/${seedActor1.username}/statuses/${id}`

interface MockNoteParams {
  content: string
  published?: number
  id?: string
  url?: string
  from?: string
  to?: string[]
  cc?: string[]
  inReplyTo?: string | null
  documents?: Document[]
  conversation?: string

  withContext?: boolean
}
export const MockMastodonNote = ({
  id = stubNoteId(),
  published = Date.now(),
  content,
  from = ACTOR1_ID,
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [],
  inReplyTo,
  documents = [],
  conversation,

  withContext
}: MockNoteParams) =>
  ({
    ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
    id,
    type: 'Note',
    summary: '',
    published: getISOTimeUTC(published),
    url: id,
    attributedTo: from,
    to,
    cc,
    sensitive: false,
    atomUri: id,
    inReplyTo,
    inReplyToAtomUri: inReplyTo,
    conversation:
      conversation ??
      `tag:${TEST_DOMAIN},${Date.now()}:objectId=${crypto.randomUUID()}:objectType=Conversation`,
    content,
    contentMap: { en: content },
    attachment: documents,
    tag: [],
    replies: {
      id: `${id}/replies`,
      type: 'Collection',
      first: {
        type: 'CollectionPage',
        next: `${id}/replies?only_other_accounts=true\u0026page=true`,
        partOf: `${id}/replies`,
        items: []
      }
    }
  } as Note)

export const MockLitepubNote = ({
  id = stubNoteId(),
  published = Date.now(),
  content,
  from = ACTOR1_ID,
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [],
  inReplyTo,
  documents,
  conversation,

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
    sensitive: null,
    source: {
      content,
      mediaType: 'text/plain'
    },
    summary: '',
    tag: [],
    to,
    type: 'Note'
  } as Note)
