import { getTranslationProvider } from '@/lib/services/translation'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/instance/#translation_languages
// Returns a map of source language → array of target languages supported by the
// configured backend. Empty when no translation backend is configured (matching
// `configuration.translation.enabled: false` in /api/v2/instance).
export const GET = traceApiRoute(
  'getInstanceTranslationLanguages',
  async (req) => {
    const provider = getTranslationProvider()
    if (!provider) {
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }

    try {
      const { source, target } = await provider.languages()
      const languagePairs = Object.fromEntries(
        source.map((sourceLanguage) => [sourceLanguage, target])
      )
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: languagePairs
      })
    } catch (error) {
      // A backend that cannot report its languages should not break the public
      // instance metadata; log the cause (otherwise this silently advertises no
      // pairs while /api/v2/instance still reports translation enabled) and fall
      // back to advertising no pairs.
      logger.error({ error }, 'Failed to load translation languages')
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  }
)
