import { NextRequest } from 'next/server'

import { getConfig } from '../../config'
import { ACTIVITIES_SHARED_KEY } from '../../constants'
import { ERROR_403 } from '../../errors'
import { AppRouterApiHandle, AppRouterParams } from './types'

export const AppRouterSharedKeyGuard =
  <P>(handle: AppRouterApiHandle<P>) =>
  async (req: NextRequest, params?: AppRouterParams<P>) => {
    const config = getConfig()
    const sharedKey = config.internalApi?.sharedKey
    if (!sharedKey) {
      return Response.json(ERROR_403, { status: 403 })
    }

    const headers = req.headers
    if (
      !headers.get(ACTIVITIES_SHARED_KEY) ||
      headers.get(ACTIVITIES_SHARED_KEY) !== sharedKey
    ) {
      return Response.json(ERROR_403, { status: 403 })
    }

    return handle(req, params)
  }
