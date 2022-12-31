import crypto from 'crypto'

import { Document } from '../activities/entities/document'
import { Note } from '../activities/entities/note'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '../jsonld/activitystream'
import { getISOTimeUTC } from '../time'

export const stubNoteId = (id = crypto.randomBytes(8).toString('hex')) =>
  `https://llun.test/users/llun/statuses/${id}`

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
  from = 'https://llun.test/users/llun',
  to = [ACTIVITY_STREAM_PUBLIC],
  cc = [],
  inReplyTo,
  documents,
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
      `tag:llun.test,${Date.now()}:objectId=${crypto.randomUUID()}:objectType=Conversation`,
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
