import { CreateStatus } from '../activities/actions/createStatus'
import { Document } from '../activities/entities/document'
import { getISOTimeUTC } from '../time'
import { MockNote } from './note'

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
  } as CreateStatus
}
