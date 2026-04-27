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
import {
  activityPubRedirectResponse,
  activityPubResponse,
  negotiateActivityPubContentType
} from '@/lib/utils/activityPubContentNegotiation'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type StatusParams = OnlyLocalUserGuardHandle & {
  statusId: string
}

export const GET = traceApiRoute(
  'getActorStatus',
  OnlyLocalUserGuard(async (database, actor, req, query: unknown) => {
    const { statusId } = await (query as AppRouterParams<StatusParams>).params
    const id = `${actor.id}/statuses/${statusId}`
    const status = await database.getStatus({
      statusId: id,
      withReplies: false
    })
    if (!status) return apiErrorResponse(404)
    if (!isStatusPubliclyReadable(status)) return apiErrorResponse(404)

    const statusWithPublicReplies =
      status.type === StatusType.enum.Announce
        ? status
        : {
            ...status,
            replies: (
              await database.getStatusReplies({
                statusId: status.id,
                url: status.url
              })
            ).filter(
              (reply): reply is StatusNote | StatusPoll =>
                reply.type !== StatusType.enum.Announce &&
                isStatusPubliclyReadable(reply)
            )
          }

    const activityPubObject = toActivityPubObject(statusWithPublicReplies)
    if (!activityPubObject) return apiErrorResponse(404)

    const contentType = negotiateActivityPubContentType(
      req.headers.get('accept')
    )
    if (contentType) {
      return activityPubResponse({
        req,
        data: { '@context': ACTIVITY_STREAM_URL, ...activityPubObject },
        contentType
      })
    }

    return activityPubRedirectResponse(
      `https://${status.actor?.domain}/@${actor.username}/${statusId}`
    )
  })
)
