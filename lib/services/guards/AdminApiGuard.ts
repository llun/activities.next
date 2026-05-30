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

// Admin endpoints accept coarse read/write, the aggregate Mastodon admin
// scopes, or any of Mastodon's granular admin scopes. The actor's admin role
// checked inside the guard is the real authorization gate; the scope list only
// proves the token was granted some form of read/write or admin access.
// Derived from Scope.options so it stays in sync when new admin scopes are added.
const ADMIN_GET_SCOPES = Scope.options.filter(
  (s): s is Scope =>
    s === 'read' || s === 'admin:read' || s.startsWith('admin:read:')
)

const ADMIN_MUTATE_SCOPES = Scope.options.filter(
  (s): s is Scope =>
    s === 'write' || s === 'admin:write' || s.startsWith('admin:write:')
)

const getRequiredOAuthScopes = (method: string): Scope[] =>
  method === HttpMethod.enum.GET ? ADMIN_GET_SCOPES : ADMIN_MUTATE_SCOPES

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
