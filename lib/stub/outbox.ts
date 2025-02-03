import { OutboxContext } from '@/lib/activities/context'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/jsonld/activitystream'

import { MockMastodonActivityPubNote } from './note'

interface Params {
  actorId: string
  withPage?: boolean
  withContext?: boolean
}

export const MockActivityPubOutbox = ({
  actorId,
  withPage = false,
  withContext = false
}: Params) => {
  if (!withPage) {
    return {
      ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
      id: `${actorId}/outbox`,
      type: 'OrderedCollection',
      totalItems: 135,
      first: `${actorId}/outbox?page=true`,
      last: `${actorId}/outbox?min_id=0&page=true`
    }
  }

  const currentTime = Date.now()
  return {
    ...(withContext ? OutboxContext : null),
    id: `${actorId}/outbox?page=true`,
    type: 'OrderedCollectionPage',
    next: `${actorId}/outbox?max_id=113052243659208538\u0026page=true`,
    prev: `${actorId}/outbox?min_id=113918971269358266\u0026page=true`,
    partOf: `${actorId}/outbox`,
    orderedItems: [
      MockMastodonActivityPubNote({
        id: `${actorId}/statuses/${currentTime - 1000}`,
        published: currentTime - 1000,
        content: 'Content 1'
      }),
      MockMastodonActivityPubNote({
        id: `${actorId}/statuses/${currentTime - 900}`,
        published: currentTime - 900,
        content: 'Content 2'
      }),
      MockMastodonActivityPubNote({
        id: `${actorId}/statuses/${Date.now() - 800}`,
        published: currentTime - 800,
        content: 'Content 3'
      })
    ]
  }
}
