import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { CreateStatus } from '../activities/actions/createStatus'
import { Document } from '../activities/entities/document'
import { MockMastodonActivityPubNote } from './note'
import { ACTOR1_ID } from './seed/actor1'

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
  from?: string
  to?: string[]
  cc?: string[]
  published?: number
}
export const MockMastodonCreateActivity = ({
  content,
  conversation,
  documents,
  from = ACTOR1_ID,
  to = ['https://www.w3.org/ns/activitystreams#Public'],
  cc = [`${ACTOR1_ID}/followers`],
  published = Date.now()
}: Params) => {
  const id = `${from}/statuses/109417500731428509`
  return {
    ...CONTEXT,
    id: `${id}/activity`,
    type: 'Create',
    actor: from,
    published: getISOTimeUTC(published),
    to,
    cc,
    object: MockMastodonActivityPubNote({
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
