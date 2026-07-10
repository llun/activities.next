import { getConfig } from '@/lib/config'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#privacy_policy
// Public, unauthenticated PrivacyPolicy entity { updated_at, content }.
// Deviation from Mastodon: Mastodon falls back to its bundled default policy
// when the admin never set one; this server ships no bundled policy, so an
// unset ACTIVITIES_PRIVACY_POLICY returns 404 (documented in
// docs/environment-variables.md). Clients hide the link on 404.
export const GET = traceApiRoute('getInstancePrivacyPolicy', async (req) => {
  const content = getConfig().privacyPolicy
  if (!content) return apiCorsError(req, CORS_HEADERS, 404)

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      // No per-document timestamp is tracked; mirror extended_description and
      // report the epoch.
      updated_at: getISOTimeUTC(0),
      content: `<p>${escapeHtml(content)}</p>`
    }
  })
})
