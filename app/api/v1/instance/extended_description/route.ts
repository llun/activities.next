import { getDatabase } from '@/lib/database'
import { resolveDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#extended_description
// The description of the domain the request arrived on (its own, else the
// server's), as one HTML paragraph. Mastodon keeps a separate extended
// description; this server has only the one description. Empty content when
// there is none, as Mastodon answers for an unset one.
export const GET = traceApiRoute(
  'getInstanceExtendedDescription',
  async (req) => {
    // Refresh first: `headerHost` trusts the visited host from the snapshot.
    await ensureServedDomainsFresh()
    const identity = await resolveDomainIdentity(
      getDatabase(),
      headerHost(req.headers)
    )
    const description = identity.description.trim()
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        updated_at: getISOTimeUTC(0),
        // The description is wrapped in HTML; escape it so special characters
        // can't produce malformed markup.
        content: description ? `<p>${escapeHtml(description)}</p>` : ''
      }
    })
  }
)
