import { getDatabase } from '@/lib/database'
import { resolveDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getPrivacyPolicyEntity } from '@/lib/services/mastodon/instancePolicies'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#privacy_policy
// Public, unauthenticated PrivacyPolicy entity { updated_at, content } for the
// domain the request arrived on, rendered from Markdown.
// Deviation from Mastodon: Mastodon falls back to its bundled default policy
// when the admin never set one; this server ships no bundled policy, so an
// unset policy returns 404 (documented in docs/environment-variables.md).
// Clients hide the link on 404.
export const GET = traceApiRoute('getInstancePrivacyPolicy', async (req) => {
  // Refresh first: `headerHost` trusts the visited host from the snapshot.
  await ensureServedDomainsFresh()
  const identity = await resolveDomainIdentity(
    getDatabase(),
    headerHost(req.headers)
  )
  const entity = getPrivacyPolicyEntity(identity)
  if (!entity) return apiCorsError(req, CORS_HEADERS, 404)

  return apiResponse({ req, allowedMethods: CORS_HEADERS, data: entity })
})
