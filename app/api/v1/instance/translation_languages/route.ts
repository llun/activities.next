import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#translation_languages
// Translation is not supported on this server (configuration.translation.enabled
// is false in /api/v2/instance), so no language pairs are available.
export const GET = traceApiRoute(
  'getInstanceTranslationLanguages',
  async (req) => {
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
  }
)
