import crypto from 'crypto'

import { Document } from '../activities/entities/document'
import { Note } from '../activities/entities/note'
import { getISOTimeUTC } from '../time'

interface MockNoteParams {
  content: string
  published?: number
  id?: string
  to?: string[]
  cc?: string[]
  inReplyTo?: string | null
  documents?: Document[]
  conversation?: string

  withContext?: boolean
}
export const MockMastodonNote = ({
  id = crypto.randomUUID(),
  published = Date.now(),
  content,
  to = ['https://www.w3.org/ns/activitystreams#Public'],
  cc = [],
  inReplyTo,
  documents,
  conversation,

  withContext
}: MockNoteParams) =>
  ({
    ...(withContext
      ? { '@context': 'https://www.w3.org/ns/activitystreams' }
      : null),
    id: `https://llun.test/users/llun/statuses/${id}`,
    type: 'Note',
    summary: '',
    published: getISOTimeUTC(published),
    url: `https://llun.test/@llun/${id}`,
    attributedTo: 'https://llun.test/users/llun',
    to,
    cc,
    sensitive: false,
    atomUri: `https://llun.test/users/llun/statuses/${id}`,
    inReplyTo,
    inReplyToAtomUri: inReplyTo,
    conversation:
      conversation ??
      `tag:llun.test,${Date.now()}:objectId=${crypto.randomUUID()}:objectType=Conversation`,
    content,
    contentMap: { en: content },
    attachment: documents,
    tag: [],
    replies: {
      id: `https://llun.test/users/llun/statuses/${id}/replies`,
      type: 'Collection',
      first: {
        type: 'CollectionPage',
        next: `https://llun.test/users/llun/statuses/${id}/replies?only_other_accounts=true\u0026page=true`,
        partOf: `https://llun.test/users/llun/statuses/${id}/replies`,
        items: []
      }
    }
  } as Note)
