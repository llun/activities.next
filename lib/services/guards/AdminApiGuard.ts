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

const getRequiredOAuthScopes = (method: string): Scope[] =>
  method === HttpMethod.enum.GET ? [Scope.enum.read] : [Scope.enum.write]

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

    const { OAuthGuard } = await import('./OAuthGuard')
    return OAuthGuard<P>(
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
