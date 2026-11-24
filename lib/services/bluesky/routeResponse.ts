import type { NextRequest } from 'next/server'

import type { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiResponse } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { BlueskyLinkError } from './account'

// Runs a Settings › Other networks Bluesky action and answers its JSON, or
// the `{ error }` a BlueskyLinkError carries.
export const blueskyRouteResponse = async (
  req: NextRequest,
  allowedMethods: HttpMethod[],
  action: () => Promise<unknown>
) => {
  try {
    return apiResponse({ req, allowedMethods, data: await action() })
  } catch (error) {
    if (error instanceof BlueskyLinkError) {
      return apiResponse({
        req,
        allowedMethods,
        data: { error: error.message },
        responseStatusCode: error.status
      })
    }
    logger.error({
      message: 'Bluesky account action failed',
      err: toLoggableError(error)
    })
    return apiResponse({
      req,
      allowedMethods,
      data: { error: 'Something went wrong. Please try again.' },
      responseStatusCode: 500
    })
  }
}
