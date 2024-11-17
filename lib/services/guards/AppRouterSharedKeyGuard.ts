import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { ACTIVITIES_SHARED_KEY } from '@/lib/constants'
import { apiErrorResponse } from '@/lib/utils/response'

import { AppRouterApiHandle, AppRouterParams } from './types'

export const AppRouterSharedKeyGuard =
  <P>(handle: AppRouterApiHandle<P>) =>
  async (req: NextRequest, params: AppRouterParams<P>) => {
    const config = getConfig()
    const sharedKey = config.internalApi?.sharedKey
    if (!sharedKey) return apiErrorResponse(403)

    const headers = req.headers
    if (
      !headers.get(ACTIVITIES_SHARED_KEY) ||
      headers.get(ACTIVITIES_SHARED_KEY) !== sharedKey
    ) {
      return apiErrorResponse(403)
    }

    return handle(req, params)
  }
