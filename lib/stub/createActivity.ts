import { CreateStatus } from '../activities/actions/createStatus'
import { Document } from '../activities/entities/document'
import { getISOTimeUTC } from '../time'
import { MockMastodonNote } from './note'

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
  to?: string[]
  cc?: string[]
  published?: number
}
export const MockMastodonCreateActivity = ({
  content,
  conversation,
  documents,
  to = ['https://www.w3.org/ns/activitystreams#Public'],
  cc = ['https://llun.test/users/llun/followers'],
  published = Date.now()
}: Params) => {
  const id = 'https://llun.test/users/llun/statuses/109417500731428509'
  return {
    ...CONTEXT,
    id: `${id}/activity`,
    type: 'Create',
    actor: 'https://llun.test/users/llun',
    published: getISOTimeUTC(published),
    to,
    cc,
    object: MockMastodonNote({
      id,
      content,
      conversation,
      documents,
      to,
      cc,
      published
    })
  } as CreateStatus
}
