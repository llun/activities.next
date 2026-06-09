import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { hasSameOriginProof } from '@/lib/services/guards/sameOriginProof'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_401,
  ERROR_403,
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.DELETE]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const DELETE = traceApiRoute(
  'unlinkProvider',
  async (
    req: NextRequest,
    props: { params: Promise<{ provider: string }> }
  ) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const session = await getServerAuthSession()
    const actor = await getActorFromSession(database, session)
    if (!actor || !actor.account) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_401,
        responseStatusCode: 401
      })
    }

    // Manually authenticated cookie-session mutation: apply the same CSRF
    // same-origin proof as AuthenticatedGuard.
    if (!hasSameOriginProof(req)) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_403,
        responseStatusCode: 403
      })
    }

    const { provider } = await props.params
    if (!provider) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    await database.unlinkAccountFromProvider({
      accountId: actor.account.id,
      provider
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { success: true }
    })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { provider: params?.provider || 'unknown' }
    }
  }
)
