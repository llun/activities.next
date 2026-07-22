import {
  OnlyLocalUserGuard,
  OnlyLocalUserGuardHandle
} from '@/lib/services/guards/OnlyLocalUserGuard'
import { AppRouterParams } from '@/lib/services/guards/types'
import { buildQuoteAuthorizationObject } from '@/lib/services/quotes/quoteAuthorization'
import {
  activityPubResponse,
  negotiateActivityPubContentType
} from '@/lib/utils/activityPubContentNegotiation'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

type QuoteAuthorizationParams = OnlyLocalUserGuardHandle & {
  id: string
}

// Serves the hosted FEP-044f QuoteAuthorization stamp while the quote is
// approved. Returns 404 once the edge is no longer `accepted` (e.g. after a
// revocation) so third parties stop treating the quote as authorized.
export const GET = traceApiRoute(
  'getQuoteAuthorization',
  OnlyLocalUserGuard(async (database, actor, req, query: unknown) => {
    const { id } = await (query as AppRouterParams<QuoteAuthorizationParams>)
      .params
    const stampUri = `${actor.id}/quote_authorizations/${id}`

    const edge = await database.getStatusQuoteByAuthorizationUri({
      authorizationUri: stampUri
    })
    if (!edge || edge.state !== 'accepted') return apiErrorResponse(404)

    // The stamp is only authoritative when issued for a status this actor owns.
    const quotedStatus = await database.getStatus({
      statusId: edge.quotedStatusId,
      withReplies: false
    })
    if (!quotedStatus || quotedStatus.actorId !== actor.id) {
      return apiErrorResponse(404)
    }

    const object = buildQuoteAuthorizationObject({
      stampUri,
      attributedTo: actor.id,
      interactingObject: edge.statusId,
      interactionTarget: edge.quotedStatusId
    })

    const contentType =
      negotiateActivityPubContentType(req.headers.get('accept')) ??
      'application/activity+json'
    return activityPubResponse({ req, data: object, contentType })
  })
)
