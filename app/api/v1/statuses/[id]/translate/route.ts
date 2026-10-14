import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { resolveStatusIdParam } from '@/lib/services/mastodon/resolveClientId'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { fetchEphemeralRemoteStatus } from '@/lib/services/statuses/fetchEphemeralRemoteStatus'
import { getTranslationProvider } from '@/lib/services/translation'
import { translateStatus } from '@/lib/services/translation/translateStatus'
import {
  TranslationProviderError,
  UnsupportedTargetLanguageError
} from '@/lib/services/translation/types'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
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

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

// Mastodon only allows translating publicly-visible statuses.
const TRANSLATABLE_VISIBILITIES = new Set(['public', 'unlisted'])

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// A stored row decides on its own; only an id with no row falls back to a
// live fetch. Remote profile pages render the actor's live outbox, whose
// statuses are never persisted, so their ids miss the database.
const getTranslatableStatus = async ({
  database,
  statusId,
  currentActor
}: {
  database: Database
  statusId: string
  currentActor: Actor
}): Promise<Status | null> => {
  const storedStatus = await database.getStatus({
    statusId,
    currentActorId: currentActor.id,
    withReplies: false
  })
  if (!storedStatus) {
    return fetchEphemeralRemoteStatus({ database, statusId, currentActor })
  }

  const canRead = await canActorReadStatus({
    database,
    status: storedStatus,
    currentActor
  })
  return canRead ? storedStatus : null
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
          : // Fall back to 'en' if the server default language list is empty
            // (e.g. ACTIVITIES_LANGUAGES='[]'), so the target is never undefined.
            (getConfig().languages[0] ?? 'en')

      const statusId = await resolveStatusIdParam(database, encodedStatusId)
      const status = await getTranslatableStatus({
        database,
        statusId,
        currentActor
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
