import { getTermsOfServiceEntity } from '@/app/api/v1/instance/terms_of_service/termsOfService'
import { getConfig } from '@/lib/config'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  date: string
}

// https://docs.joinmastodon.org/methods/instance/#terms_of_service_date
// Looks a historical version up by effective date. Only the single
// config-backed version exists, so any other date 404s exactly like Mastodon
// does for an unknown date.
export const GET = traceApiRoute<Params>(
  'getInstanceTermsOfServiceByDate',
  async (req, context) => {
    const { date } = await context.params
    const entity = getTermsOfServiceEntity(getConfig())
    if (!entity || entity.effective_date !== date) {
      return apiCorsError(req, CORS_HEADERS, 404)
    }

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: entity })
  }
)
