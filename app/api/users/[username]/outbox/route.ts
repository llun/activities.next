import type { Database } from '@/lib/database/types'
import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { isStatusPubliclyReadable } from '@/lib/services/statusAccess'
import {
  AnnounceAction,
  CreateAction
} from '@/lib/types/activitypub/activities'
import { StatusType, toActivityPubObject } from '@/lib/types/domain/status'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { getLocalActorOutboxId } from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const getPubliclyReadableActorStatuses = async (
  database: Database,
  actorId: string,
  limit?: number
) =>
  (
    await database.getActorStatuses({
      actorId,
      ...(limit === undefined ? {} : { limit }),
      publicOnly: true
    })
  ).filter(isStatusPubliclyReadable)

export const GET = traceApiRoute(
  'getActorOutbox',
  OnlyLocalUserGuard(
    async (database, actor, req) => {
      const url = new URL(req.url)
      const pageParam = url.searchParams.get('page')
      if (!pageParam) {
        const outboxId = getLocalActorOutboxId(actor.id)
        const totalItems = await database.getActorStatusesCount({
          actorId: actor.id,
          publicOnly: true
        })
        return activityPubResponse({
          req,
          data: {
            '@context': ACTIVITY_STREAM_URL,
            id: outboxId,
            type: 'OrderedCollection',
            totalItems,
            first: `${outboxId}?page=true`,
            last: `${outboxId}?min_id=0&page=true`
          }
        })
      }

      const statuses = await getPubliclyReadableActorStatuses(
        database,
        actor.id
      )
      // publicOnly checks the Announce recipients in SQL; this second filter
      // also confirms the boosted original status is publicly readable.
      const items = statuses.map((status) => {
        if (status.type === StatusType.enum.Announce) {
          return {
            id: status.id,
            type: AnnounceAction,
            actor: actor.id,
            published: getISOTimeUTC(status.createdAt),
            ...(status.to ? { to: status.to } : null),
            ...(status.cc ? { cc: status.cc } : null),
            object: status.originalStatus.id
          }
        }

        return {
          id: `${status.id}/activity`,
          type: CreateAction,
          actor: actor.id,
          published: getISOTimeUTC(status.createdAt),
          ...(status.to ? { to: status.to } : null),
          ...(status.cc ? { cc: status.cc } : null),
          object: toActivityPubObject(status)
        }
      })

      return activityPubResponse({
        req,
        data: {
          '@context': ACTIVITY_STREAM_URL,
          id: `${getLocalActorOutboxId(actor.id)}?page=true`,
          type: 'OrderedCollectionPage',
          partOf: getLocalActorOutboxId(actor.id),
          orderedItems: items
        }
      })
    },
    {
      allowFederationSigningActor: true
    }
  )
)
