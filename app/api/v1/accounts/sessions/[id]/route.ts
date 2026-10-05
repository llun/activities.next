import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  DEFAULT_202,
  ERROR_400,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  // `sessions.id`, never the session token: the token is the credential behind
  // the session cookie, so it must not appear in a URL, a trace or the page
  // that lists sessions.
  id: string
}

export const DELETE = traceApiRoute(
  'deleteSession',
  AuthenticatedGuard<Params>(
    async (req, context) => {
      const { database, currentActor, params } = context
      const { id } = (await params) ?? { id: undefined }
      const accountId = currentActor.account?.id
      if (!id || !accountId)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })

      // Scoped to the caller's account in the delete itself; a foreign or
      // unknown id deletes nothing and reads as not found.
      const deleted = await database.deleteAccountSessionById({
        accountId,
        id
      })
      if (deleted === 0)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: DEFAULT_202
      })
    },
    { allowModerationBlocked: true }
  ),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { sessionId: params?.id || 'unknown' }
    }
  }
)
