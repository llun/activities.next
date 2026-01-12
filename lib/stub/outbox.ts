import { OutboxContext } from '@/lib/activities/context'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_URL
} from '@/lib/utils/activitystream'

import { getISOTimeUTC } from '../utils/getISOTimeUTC'
import { MockMastodonActivityPubNote } from './note'

type OutboxItem = {
  id?: string
  published?: number
  content: string
  to?: string[]
  cc?: string[]
}

interface Params {
  actorId: string
  withPage?: boolean
  withContext?: boolean
  totalItems?: number
  items?: OutboxItem[]
  next?: string | null
  prev?: string | null
}

export const MockActivityPubOutbox = ({
  actorId,
  withPage = false,
  withContext = false,
  totalItems,
  items,
  next,
  prev
}: Params) => {
  const resolvedTotalItems = totalItems ?? 10

  if (!withPage) {
    return {
      ...(withContext ? { '@context': ACTIVITY_STREAM_URL } : null),
      id: `${actorId}/outbox`,
      type: 'OrderedCollection',
      totalItems: resolvedTotalItems,
      ...(resolvedTotalItems > 0
        ? { first: `${actorId}/outbox?page=true` }
        : null),
      ...(resolvedTotalItems > 0
        ? { last: `${actorId}/outbox?min_id=0&page=true` }
        : null)
    }
  }

  const currentTime = Date.now()
  const defaultItems: OutboxItem[] = [
    {
      published: currentTime - 1000,
      content: 'Content 1'
    },
    {
      published: currentTime - 900,
      content: 'Content 2'
    },
    {
      published: currentTime - 800,
      content: 'Content 2'
    }
  ]
  const resolvedItems = items ?? defaultItems
  return {
    ...(withContext ? OutboxContext : null),
    id: `${actorId}/outbox?page=true`,
    type: 'OrderedCollectionPage',
    ...(next !== undefined
      ? next === null
        ? null
        : { next }
      : {
          next: `${actorId}/outbox?max_id=113052243659208538\u0026page=true`
        }),
    ...(prev !== undefined
      ? prev === null
        ? null
        : { prev }
      : {
          prev: `${actorId}/outbox?min_id=113918971269358266\u0026page=true`
        }),
    partOf: `${actorId}/outbox`,
    orderedItems: resolvedItems.map((item, index) => {
      const published = item.published ?? currentTime - 1000 + index * 100
      const statusId = item.id ?? `${actorId}/statuses/${published.toString()}`
      const to = item.to ?? [ACTIVITY_STREAM_PUBLIC]
      const cc = item.cc ?? [`${actorId}/followers`, actorId]
      return {
        id: `${statusId}/activity`,
        type: 'Create',
        actor: actorId,
        published: getISOTimeUTC(published),
        to,
        cc,
        object: MockMastodonActivityPubNote({
          id: statusId,
          published,
          content: item.content,
          to,
          cc
        })
      }
    })
  }
}
