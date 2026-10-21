import { getDatabase } from '@/lib/database'
import { resolveDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getTermsOfServiceEntity } from '@/lib/services/mastodon/instancePolicies'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#terms_of_service
// Public, unauthenticated. The terms of the domain the request arrived on,
// rendered from Markdown; 404 when none are set, as Mastodon does.
export const GET = traceApiRoute('getInstanceTermsOfService', async (req) => {
  // Refresh first: `headerHost` trusts the visited host from the snapshot.
  await ensureServedDomainsFresh()
  const identity = await resolveDomainIdentity(
    getDatabase(),
    headerHost(req.headers)
  )
  const entity = getTermsOfServiceEntity(identity)
  if (!entity) return apiCorsError(req, CORS_HEADERS, 404)

  return apiResponse({ req, allowedMethods: CORS_HEADERS, data: entity })
})
