import type { NextRequest } from 'next/server'

import type { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { type StatusCode, apiResponse } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { PdsError } from './errors'
import { PlcDirectoryError } from './plc'

// The statuses a hosted-account action may answer with. A PdsError carries its
// own; anything else (a 400 validation, a 404) is reported as 422 so the card
// shows the message rather than a generic failure.
const HOSTED_ERROR_STATUSES = new Set<number>([403, 409, 422])

const hostedErrorStatus = (error: PdsError): StatusCode =>
  HOSTED_ERROR_STATUSES.has(error.statusCode)
    ? (error.statusCode as StatusCode)
    : 422

// Runs a Settings › Bluesky hosted-account action and answers its JSON, or the
// `{ error }` a typed error carries. A PLC directory failure is a 502: the
// account's identity lives there, not here.
export const hostedBlueskyRouteResponse = async (
  req: NextRequest,
  allowedMethods: HttpMethod[],
  action: () => Promise<unknown>
) => {
  try {
    return apiResponse({ req, allowedMethods, data: await action() })
  } catch (error) {
    if (error instanceof PlcDirectoryError) {
      logger.error({
        message: 'PLC directory request failed',
        err: toLoggableError(error)
      })
      return apiResponse({
        req,
        allowedMethods,
        data: {
          error: 'The PLC directory could not be reached. Try again later.'
        },
        responseStatusCode: 502
      })
    }
    if (error instanceof PdsError) {
      return apiResponse({
        req,
        allowedMethods,
        data: { error: error.message },
        responseStatusCode: hostedErrorStatus(error)
      })
    }
    logger.error({
      message: 'Hosted Bluesky account action failed',
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
