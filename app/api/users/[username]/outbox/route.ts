import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import type { Database } from '@/lib/database/types'
import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { isStatusPubliclyReadable } from '@/lib/services/statusAccess'
import { getCachedActorPublicStatusCount } from '@/lib/services/statuses/actorPublicStatusCount'
import {
  AnnounceAction,
  CreateAction
} from '@/lib/types/activitypub/activities'
import {
  Status,
  StatusType,
  toActivityPubObject
} from '@/lib/types/domain/status'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { getLocalActorOutboxId } from '@/lib/utils/activitypubId'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const getPubliclyReadableActorStatuses = async (
  database: Database,
  actorId: string,
  limit = PER_PAGE_LIMIT
) => {
  const statuses: Status[] = []
  let maxStatusId: string | undefined

  while (statuses.length < limit) {
    const batch = await database.getActorStatuses({
      actorId,
      limit,
      ...(maxStatusId ? { maxStatusId } : {}),
      publicOnly: true
    })
    if (batch.length === 0) break

    statuses.push(...batch.filter(isStatusPubliclyReadable))
    if (batch.length < limit) break

    maxStatusId = batch[batch.length - 1].id
  }

  return statuses.slice(0, limit)
}

export const GET = traceApiRoute(
  'getActorOutbox',
  OnlyLocalUserGuard(
    async (database, actor, req) => {
      const url = new URL(req.url)
      const pageParam = url.searchParams.get('page')
      if (!pageParam) {
        const outboxId = getLocalActorOutboxId(actor.id)
        const totalItems = await getCachedActorPublicStatusCount(
          database,
          actor.id
        )
        return activityPubResponse({
          req,
          data: {
            '@context': ACTIVITY_STREAM_URL,
            id: outboxId,
            type: 'OrderedCollection',
            totalItems,
            first: `${outboxId}?page=true`,
            last: `${outboxId}?min_id=0&page=true`
          },
          // The root is a single aggregate over the actor's whole public
          // history and the only branch a remote server re-fetches in bursts,
          // so it is the one that gets a shared-cache lifetime — matching the
          // TTL behind `totalItems`, so the CDN and the process cannot disagree
          // about how stale the number may be.
          //
          // Deliberately NOT on `?page=true` below: that branch's
          // `orderedItems` reflects each status's live visibility, and a status
          // hidden mid-window must stop being served immediately rather than
          // linger in a shared cache.
          additionalHeaders: [
            ['Cache-Control', 'public, max-age=60, s-maxage=60']
          ]
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
          // The Create objects come from toActivityPubObject, which emits
          // the FEP-044f quote aliases, an attachment's blurhash/focalPoint,
          // the Hashtag/Emoji tag types and a poll's votersCount; a receiver
          // that compacts drops any term its context never defined. The note
          // context declares all of them and supersets the quote one.
          '@context': NOTE_ACTIVITY_CONTEXT,
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
