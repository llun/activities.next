import {
  OnlyLocalUserGuard,
  OnlyLocalUserGuardHandle
} from '@/lib/services/guards/OnlyLocalUserGuard'
import { AppRouterParams } from '@/lib/services/guards/types'
import { isStatusPubliclyReadable } from '@/lib/services/statusAccess'
import {
  StatusNote,
  StatusPoll,
  StatusType,
  toActivityPubObject
} from '@/lib/types/domain/status'
import { activityPubResponse } from '@/lib/utils/activityPubContentNegotiation'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type StatusRepliesParams = OnlyLocalUserGuardHandle & {
  statusId: string
}

const ACTIVITYPUB_REPLIES_LIMIT = 100

export const GET = traceApiRoute(
  'getActorStatusReplies',
  OnlyLocalUserGuard(async (database, actor, req, query: unknown) => {
    const { statusId } = await (query as AppRouterParams<StatusRepliesParams>)
      .params
    const id = `${actor.id}/statuses/${statusId}`
    const status = await database.getStatus({
      statusId: id,
      withReplies: false
    })
    if (!status) return apiErrorResponse(404)
    if (!isStatusPubliclyReadable(status)) return apiErrorResponse(404)
    if (status.type === StatusType.enum.Announce) return apiErrorResponse(404)

    const replies = (
      await database.getStatusReplies({
        statusId: status.id,
        url: status.url,
        publicOnly: true,
        limit: ACTIVITYPUB_REPLIES_LIMIT
      })
    ).filter(
      (reply): reply is StatusNote | StatusPoll =>
        reply.type !== StatusType.enum.Announce &&
        isStatusPubliclyReadable(reply)
    )

    return activityPubResponse({
      req,
      data: {
        '@context': ACTIVITY_STREAM_URL,
        id: `${status.id}/replies`,
        type: 'Collection',
        totalItems: replies.length,
        items: replies.map((reply) => toActivityPubObject(reply))
      }
    })
  })
)
