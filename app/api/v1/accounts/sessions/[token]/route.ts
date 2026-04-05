import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { DEFAULT_202, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  token: string
}

export const DELETE = traceApiRoute(
  'deleteSession',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { database, currentActor, params } = context
    const { token } = (await params) ?? { token: undefined }
    if (!token)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Bad Request' },
        responseStatusCode: 400
      })

    const accountSession = await database.getAccountSession({ token })
    if (!accountSession)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Not Found' },
        responseStatusCode: 404
      })

    if (accountSession.account.id !== currentActor.account?.id) {
      throw new Error('Invalid token')
    }

    await database.deleteAccountSession({ token })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: DEFAULT_202 })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { token: params?.token || 'unknown' }
    }
  }
)
