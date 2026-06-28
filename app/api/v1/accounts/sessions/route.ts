import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_400, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Revoke every session for the account except the one making this request —
// "sign out everywhere else". The current session is identified by its
// better-auth token (the value stored in `sessions.token`), so it is always
// preserved even though every other device is signed out.
export const DELETE = traceApiRoute(
  'deleteOtherSessions',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const accountId = currentActor.account?.id
    const currentToken = (await getServerAuthSession())?.session?.token
    if (!accountId || !currentToken) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const revoked = await database.deleteOtherAccountSessions({
      accountId,
      exceptToken: currentToken
    })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { revoked }
    })
  })
)
