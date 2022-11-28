import crypto from 'crypto'

import { Document } from '../activities/entities/document'
import { Note } from '../activities/entities/note'
import { getISOTimeUTC } from '../time'

const CONTEXT = {
  '@context': [
    'https://www.w3.org/ns/activitystreams',
    {
      ostatus: 'http://ostatus.org#',
      atomUri: 'ostatus:atomUri',
      inReplyToAtomUri: 'ostatus:inReplyToAtomUri',
      conversation: 'ostatus:conversation',
      sensitive: 'as:sensitive',
      toot: 'http://joinmastodon.org/ns#',
      votersCount: 'toot:votersCount',
      blurhash: 'toot:blurhash',
      focalPoint: { '@container': '@list', '@id': 'toot:focalPoint' }
    }
  ]
}

interface MockNoteParams {
  content: string
  published?: number
  documents?: Document[]
  conversation?: string
}
export const MockNote = ({
  published = Date.now(),
  content,
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
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: ['https://glasgow.social/users/llun/followers'],
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

interface Params {
  content: string
  conversation?: string
  documents?: Document[]
  published?: number
}
export const MockCreateActivity = ({
  content,
  conversation,
  documents,
  published = Date.now()
}: Params) => {
  return {
    ...CONTEXT,
    id: 'https://glasgow.social/users/llun/statuses/109417500731428509/activity',
    type: 'Create',
    actor: 'https://glasgow.social/users/llun',
    published: getISOTimeUTC(published),
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: ['https://glasgow.social/users/llun/followers'],
    object: MockNote({ content, conversation, documents, published })
  }
}
