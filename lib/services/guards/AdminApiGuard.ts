import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Scope } from '@/lib/types/database/operations'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { HttpMethod } from '@/lib/utils/http-headers'
import { HTTP_STATUS, apiResponse } from '@/lib/utils/response'

import { AppRouterParams } from './types'

type AdminApiHandle<P> = (
  request: NextRequest,
  context: {
    database: Database
    params: Promise<P>
  }
) => Promise<Response> | Response

// Admin endpoints accept the coarse read/write scopes (backwards compatibility
// for tokens with plain read/write) or the Mastodon aggregate admin scopes
// (admin:read for GET, admin:write for mutations). The actor's admin role
// checked inside the guard is the real authorization gate.
//
// Granular admin scopes (admin:read:domain_blocks, admin:read:accounts, …) are
// recognised in the vocabulary so admin clients can register and authorize, but
// they are NOT accepted here because accepting all admin:read:* scopes would
// allow a token consented only for admin:read:accounts to access domain_blocks
// and vice-versa. Proper per-route scope enforcement (Tier 2 work) would
// require each admin route to declare its specific granular scope requirements.
const getRequiredOAuthScopes = (method: string): Scope[] =>
  method === HttpMethod.enum.GET
    ? [Scope.enum.read, Scope.enum['admin:read']]
    : [Scope.enum.write, Scope.enum['admin:write']]

export const AdminApiGuard =
  <P>(allowedMethods: HttpMethod[], handle: AdminApiHandle<P>) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods,
        data: { error: 'Database unavailable' },
        responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      })
    }

    const session = await getServerAuthSession()
    const admin = await getAdminFromSession(database, session)
    if (admin) {
      return handle(req, { database, params: context.params })
    }

    if (!req.headers.get('Authorization')) {
      return apiResponse({
        req,
        allowedMethods,
        data: { error: 'Forbidden' },
        responseStatusCode: HTTP_STATUS.FORBIDDEN
      })
    }

    const { OAuthGuardAnyScope } = await import('./OAuthGuard')
    return OAuthGuardAnyScope<P>(
      getRequiredOAuthScopes(req.method),
      async (oauthReq, { currentActor, database: oauthDatabase, params }) => {
        if (currentActor.account?.role !== 'admin') {
          return apiResponse({
            req: oauthReq,
            allowedMethods,
            data: { error: 'Forbidden' },
            responseStatusCode: HTTP_STATUS.FORBIDDEN
          })
        }

        return handle(oauthReq, { database: oauthDatabase, params })
      }
    )(req, context)
  }
