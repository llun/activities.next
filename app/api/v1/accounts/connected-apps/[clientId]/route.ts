import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  DEFAULT_202,
  ERROR_400,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  clientId: string
}

// Revoke a connected app (or SSO sign-in) the account authorized. The grant is
// scoped to a specific actor via the `actorId` query param (the consent's
// referenceId); omit it to revoke an account-scoped grant with no actor. The
// database method only ever touches rows owned by this account, so an account
// can never revoke another's grant.
export const DELETE = traceApiRoute(
  'revokeConnectedApp',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { database, currentActor, params } = context
    const accountId = currentActor.account?.id
    const { clientId } = (await params) ?? { clientId: undefined }
    if (!accountId || !clientId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    // Treat a missing OR empty actorId the same: the null (no-actor) grant.
    const actorId = req.nextUrl.searchParams.get('actorId') || null
    await database.revokeAccountConnectedApp({ accountId, clientId, actorId })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: DEFAULT_202 })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { clientId: params?.clientId || 'unknown' }
    }
  }
)
