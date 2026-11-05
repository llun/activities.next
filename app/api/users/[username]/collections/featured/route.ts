import { NOTE_ACTIVITY_CONTEXT } from '@/lib/activities/noteContext'
import type { Database } from '@/lib/database/types'
import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { MAX_PINNED_STATUSES } from '@/lib/services/mastodon/constants'
import { isStatusPubliclyReadable } from '@/lib/services/statusAccess'
import {
  type StatusNote,
  type StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { getLocalActorFeaturedCollectionId } from '@/lib/utils/activitypubId'
import { toActivityPubObject } from '@/lib/utils/toActivityPubObject'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const PINNED_STATUS_LOOKUP_BATCH_SIZE = MAX_PINNED_STATUSES * 4

const getPubliclyReadablePinnedStatuses = async (
  database: Database,
  actorId: string
): Promise<Array<StatusNote | StatusPoll>> => {
  const pinnedStatusIds = await database.getPinnedStatusIds({ actorId })
  if (pinnedStatusIds.length === 0) return []

  const featuredStatuses: Array<StatusNote | StatusPoll> = []
  for (
    let offset = 0;
    offset < pinnedStatusIds.length &&
    featuredStatuses.length < MAX_PINNED_STATUSES;
    offset += PINNED_STATUS_LOOKUP_BATCH_SIZE
  ) {
    const batchIds = pinnedStatusIds.slice(
      offset,
      offset + PINNED_STATUS_LOOKUP_BATCH_SIZE
    )
    const statuses = await database.getStatusesByIds({
      statusIds: batchIds,
      withReplies: false
    })
    for (const status of statuses) {
      if (
        status.actorId !== actorId ||
        status.type === StatusType.enum.Announce ||
        !isStatusPubliclyReadable(status)
      ) {
        continue
      }
      featuredStatuses.push(status)
      if (featuredStatuses.length >= MAX_PINNED_STATUSES) break
    }
  }

  return featuredStatuses
}

export const GET = traceApiRoute(
  'getActorFeaturedCollection',
  OnlyLocalUserGuard(
    async (database, actor, req) => {
      const statuses = await getPubliclyReadablePinnedStatuses(
        database,
        actor.id
      )
      const orderedItems = statuses.map((status) => toActivityPubObject(status))

      return activityPubResponse({
        req,
        data: {
          // Items come from toActivityPubObject, which emits FEP-044f quote
          // aliases, attachment blurhash/focalPoint, Hashtag/Emoji tag types,
          // sensitive, and poll votersCount; NOTE_ACTIVITY_CONTEXT declares all
          // of them so receivers that compact the document keep them.
          '@context': NOTE_ACTIVITY_CONTEXT,
          id: getLocalActorFeaturedCollectionId(actor.id),
          type: 'OrderedCollection',
          totalItems: orderedItems.length,
          orderedItems
        }
      })
    },
    {
      allowFederationSigningActor: true
    }
  )
)
