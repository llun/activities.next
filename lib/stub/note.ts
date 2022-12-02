import crypto from 'crypto'

import { Document } from '../activities/entities/document'
import { Note } from '../activities/entities/note'
import { getISOTimeUTC } from '../time'

interface MockNoteParams {
  content: string
  published?: number
  to?: string[]
  cc?: string[]
  documents?: Document[]
  conversation?: string
}
export const MockMastodonNote = ({
  published = Date.now(),
  content,
  to = ['https://www.w3.org/ns/activitystreams#Public'],
  cc = [],
  documents,
  conversation
}: MockNoteParams) =>
  ({
    id: 'https://glasgow.social/users/llun/statuses/109417500731428509',
    type: 'Note',
    summary: null,
    inReplyTo: null,
    published: getISOTimeUTC(published),
    url: 'https://glasgow.social/@llun/109417500731428509',
    attributedTo: 'https://glasgow.social/users/llun',
    to,
    cc,
    sensitive: false,
    atomUri: 'https://glasgow.social/users/llun/statuses/109417500731428509',
    inReplyToAtomUri: null,
    conversation:
      conversation ??
      `tag:glasgow.social,${Date.now()}:objectId=${crypto.randomUUID()}:objectType=Conversation`,
    content,
    contentMap: { en: content },
    attachment: documents,
    tag: [],
    replies: {
      id: 'https://glasgow.social/users/llun/statuses/109417500731428509/replies',
      type: 'Collection',
      first: {
        type: 'CollectionPage',
        next: 'https://glasgow.social/users/llun/statuses/109417500731428509/replies?only_other_accounts=true\u0026page=true',
        partOf:
          'https://glasgow.social/users/llun/statuses/109417500731428509/replies',
        items: []
      }
    }
  } as Note)
