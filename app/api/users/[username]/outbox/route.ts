import { AnnounceAction, CreateAction } from '@/lib/activities/actions/types'
import { StatusType } from '@/lib/models/status'
import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/jsonld/activitystream'

export const GET = OnlyLocalUserGuard(async (storage, actor, req) => {
  const url = new URL(req.url)
  const pageParam = url.searchParams.get('page')
  if (!pageParam) {
    const outboxId = `${actor.id}/outbox`
    return Response.json({
      '@context': ACTIVITY_STREAM_URL,
      id: outboxId,
      type: 'OrderedCollection',
      totalItems: actor.data.statusCount,
      first: `${outboxId}?page=true`,
      last: `${outboxId}?min_id=0&page=true`
    })
  }

  const statuses = await storage.getActorStatuses({ actorId: actor.id })
  const items = statuses.map((status) => {
    if (status.data.type === StatusType.enum.Announce) {
      return {
        id: status.id,
        type: AnnounceAction,
        actor: actor.id,
        published: getISOTimeUTC(status.createdAt),
        ...(status.to ? { to: status.to } : null),
        ...(status.cc ? { cc: status.cc } : null),
        object: status.data.originalStatus.id
      }
    }

    return {
      id: `${status.id}/activity`,
      type: CreateAction,
      actor: actor.id,
      published: getISOTimeUTC(status.createdAt),
      ...(status.to ? { to: status.to } : null),
      ...(status.cc ? { cc: status.cc } : null),
      object: status.toObject()
    }
  })

  return Response.json({
    '@context': ACTIVITY_STREAM_URL,
    id: `${actor.id}/outbox?page=true`,
    type: 'OrderedCollectionPage',
    partOf: `${actor.id}/outbox`,
    orderedItems: items
  })
})
