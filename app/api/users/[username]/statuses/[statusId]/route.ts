import { buildBaseURL } from '@/lib/config'
import {
  OnlyLocalUserGuard,
  OnlyLocalUserGuardHandle
} from '@/lib/services/guards/OnlyLocalUserGuard'
import { AppRouterParams } from '@/lib/services/guards/types'
import { isStatusPubliclyReadable } from '@/lib/services/statusAccess'
import { getMention } from '@/lib/types/domain/actor'
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
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type StatusParams = OnlyLocalUserGuardHandle & {
  statusId: string
}

const ACTIVITYPUB_REPLIES_LIMIT = 100

export const GET = traceApiRoute(
  'getActorStatus',
  OnlyLocalUserGuard(async (database, actor, req, query: unknown) => {
    const { statusId } = await (query as AppRouterParams<StatusParams>).params
    const status = await database.getActorStatusFromPathSegment({
      actorId: actor.id,
      pathSegment: statusId,
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
                url: status.url,
                publicOnly: true,
                limit: ACTIVITYPUB_REPLIES_LIMIT
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

    // Build the HTML location with the same helper the web UI links with, so
    // it is byte-identical to the href a reader would have clicked and is
    // guaranteed to resolve through `resolveStatusFromPath`. Neither the raw
    // path segment nor `status.url` works: the segment can be a publicId while
    // the status URI's tail is something else (every status created before
    // publicIds existed, every Strava fallback note), and `status.url` for a
    // local status is `https://host/@user/<tail>` — a SINGLE-@ actor segment,
    // which the web page rejects because it splits the actor on `@` and
    // requires a `username`/`domain` pair. Both 404 a status this route just
    // resolved.
    //
    // The base URL comes from the actor's own domain rather than `getBaseURL()`
    // so a multi-domain deployment keeps the reader on the host they requested
    // — `OnlyLocalUserGuard` resolved this actor from that host's header.
    const detailPath =
      getStatusDetailPath(status) ??
      // Only reachable when the status carries no actor profile; the full
      // status URI is the one status segment that resolves without one.
      `/${getMention(actor, true)}/${encodeURIComponent(status.id)}`
    return activityPubRedirectResponse(
      `${buildBaseURL(actor.domain)}${detailPath}`
    )
  })
)
