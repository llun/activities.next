import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { HTTP_STATUS, apiResponse } from '@/lib/utils/response'

import { AppRouterParams } from './types'

type AdminApiHandle<P> = (
  request: NextRequest,
  context: {
    database: Database
    params: Promise<P>
  }
) => Promise<Response> | Response

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
    if (!admin) {
      return apiResponse({
        req,
        allowedMethods,
        data: { error: 'Forbidden' },
        responseStatusCode: HTTP_STATUS.FORBIDDEN
      })
    }

    return handle(req, { database, params: context.params })
  }
