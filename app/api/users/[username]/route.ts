import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import {
  activityPubResponse,
  negotiateActivityPubContentType
} from '@/lib/utils/activityPubContentNegotiation'
import { getPersonFromActor } from '@/lib/utils/getPersonFromActor'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const GET = traceApiRoute(
  'getActor',
  OnlyLocalUserGuard(async (_, actor, req) => {
    const contentType = negotiateActivityPubContentType(
      req.headers.get('accept')
    )
    if (contentType) {
      return activityPubResponse({
        req,
        data: getPersonFromActor(actor),
        contentType
      })
    }

    return Response.redirect(`https://${actor.domain}/@${actor.username}`)
  })
)
