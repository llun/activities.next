import { getConfig } from '@/lib/config'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { getTermsOfServiceEntity } from './termsOfService'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#terms_of_service
// Public, unauthenticated. Mastodon 404s when no terms of service are
// configured; this server does the same when ACTIVITIES_TERMS_OF_SERVICE is
// unset.
export const GET = traceApiRoute('getInstanceTermsOfService', async (req) => {
  const entity = getTermsOfServiceEntity(getConfig())
  if (!entity) return apiCorsError(req, CORS_HEADERS, 404)

  return apiResponse({ req, allowedMethods: CORS_HEADERS, data: entity })
})
