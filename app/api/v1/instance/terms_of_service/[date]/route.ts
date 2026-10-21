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

interface Params {
  date: string
}

// https://docs.joinmastodon.org/methods/instance/#terms_of_service_date
// Looks a version up by effective date. Only the current version is kept, so
// any other date 404s exactly like Mastodon does for an unknown date.
export const GET = traceApiRoute<Params>(
  'getInstanceTermsOfServiceByDate',
  async (req, context) => {
    const { date } = await context.params
    // Refresh first: `headerHost` trusts the visited host from the snapshot.
    await ensureServedDomainsFresh()
    const identity = await resolveDomainIdentity(
      getDatabase(),
      headerHost(req.headers)
    )
    const entity = getTermsOfServiceEntity(identity)
    if (!entity || entity.effective_date !== date) {
      return apiCorsError(req, CORS_HEADERS, 404)
    }

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: entity })
  }
)
