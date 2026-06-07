import { getConfig } from '@/lib/config'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { getReadableStatus } from '@/lib/services/statusRouteAccess'
import { getTranslationProvider } from '@/lib/services/translation'
import { translateStatus } from '@/lib/services/translation/translateStatus'
import {
  TranslationProviderError,
  UnsupportedTargetLanguageError
} from '@/lib/services/translation/types'
import { Scope } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  ERROR_422,
  apiCorsError,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

// Mastodon only allows translating publicly-visible statuses.
const TRANSLATABLE_VISIBILITIES = new Set(['public', 'unlisted'])

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// https://docs.joinmastodon.org/methods/statuses/#translate
// When no backend is configured, Mastodon returns 404 (NotConfiguredError);
// the /api/v2/instance `translation.enabled` flag tells clients up front whether
// to surface the Translate action at all.
export const POST = traceApiRoute(
  'translateStatus',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { database, currentActor, params } = context

      const provider = getTranslationProvider()
      if (!provider) return apiCorsError(req, CORS_HEADERS, 404)

      const encodedStatusId = (await params).id
      if (!encodedStatusId) return apiCorsError(req, CORS_HEADERS, 404)

      // `lang` is optional; a paramless POST resolves to {}. A present-but-
      // malformed body is a client error (422), matching the other status
      // action routes, rather than being silently translated to the default.
      let body: Record<string, unknown>
      try {
        body = await getRequestBody(req)
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }
      const requestedLanguage =
        typeof body.lang === 'string' && body.lang.length > 0
          ? body.lang
          : getConfig().languages[0]

      const statusId = idToUrl(encodedStatusId)
      const status = await getReadableStatus({
        database,
        statusId,
        currentActor,
        withReplies: false
      })
      if (!status) return apiCorsError(req, CORS_HEADERS, 404)

      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        currentActor.id
      )
      if (!mastodonStatus) return apiCorsError(req, CORS_HEADERS, 404)

      if (!TRANSLATABLE_VISIBILITIES.has(mastodonStatus.visibility)) {
        return apiCorsError(req, CORS_HEADERS, 403)
      }

      try {
        const translation = await translateStatus({
          database,
          provider,
          status: mastodonStatus,
          targetLanguage: requestedLanguage
        })
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: translation
        })
      } catch (error) {
        if (error instanceof UnsupportedTargetLanguageError) {
          return apiCorsError(req, CORS_HEADERS, 403)
        }
        if (error instanceof TranslationProviderError) {
          // Backend failure / unexpected response: log the cause (the catch
          // returns a Response, so the trace span would otherwise show a bare
          // 503) and return 503 so clients can retry or hide the action.
          logger.error({ error }, 'Status translation backend failed')
          return apiCorsError(req, CORS_HEADERS, 503)
        }
        // Anything else is an unexpected bug, not a backend problem; re-throw so
        // traceApiRoute records the exception and surfaces a traced 500 instead
        // of masking it as "backend unavailable".
        throw error
      }
    }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { statusId: params?.id || 'unknown' }
    }
  }
)
