import type { NextRequest } from 'next/server'

import { comparePassword } from '@/lib/services/auth/passwordHash'
import { checkPasswordChangeRateLimit } from '@/lib/services/auth/routeRateLimits'
import type { Actor } from '@/lib/types/domain/actor'
import type { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  type StatusCode,
  apiRateLimitedResponse,
  apiResponse
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { PdsError, PdsLockTimeoutError } from './errors'
import { PlcDirectoryError } from './plc'

// The statuses a hosted-account action may answer with. A PdsError carries its
// own; anything else (a 400 validation, a 404) is reported as 422 so the card
// shows the message rather than a generic failure.
const HOSTED_ERROR_STATUSES = new Set<number>([403, 409, 422, 429])

// The move route keeps a 400 (a bad destination URL) and a 502 (the
// destination server refused or could not be reached) as they are.
export const MOVE_ERROR_STATUSES = new Set<number>([
  400, 403, 409, 422, 429, 502
])

const errorStatus = (error: PdsError, statuses: Set<number>): StatusCode =>
  statuses.has(error.statusCode) ? (error.statusCode as StatusCode) : 422

const forbidden = (
  req: NextRequest,
  allowedMethods: HttpMethod[],
  error: string
) =>
  apiResponse({
    req,
    allowedMethods,
    data: { error },
    responseStatusCode: 403
  })

/**
 * Step-up check for sensitive hosted-account operations (changing the recovery
 * key or switching a moved account's PLC identity): a hijacked session alone
 * must not be able to hand the account's identity to another key or server.
 * Answers the refusal response, or `null` when the password checks out.
 */
export const checkCurrentPassword = async (
  req: NextRequest,
  actor: Actor,
  currentPassword: string | undefined,
  allowedMethods: HttpMethod[],
  noPasswordMessage = 'Set a password before changing your recovery key. Use "Forgot password" to set one; the link is sent to your email address.'
) => {
  const account = actor.account
  if (!account?.passwordHash) {
    return forbidden(req, allowedMethods, noPasswordMessage)
  }
  const limit = await checkPasswordChangeRateLimit(account.id)
  if (!limit.allowed) {
    return apiRateLimitedResponse(req, limit.retryAfterSeconds, allowedMethods)
  }
  if (!currentPassword) {
    return forbidden(req, allowedMethods, 'Current password is required')
  }
  if (!(await comparePassword(currentPassword, account.passwordHash))) {
    return forbidden(req, allowedMethods, 'Current password is incorrect')
  }
  return null
}

// Runs a Settings › Bluesky hosted-account action and answers its JSON, or the
// `{ error }` a typed error carries. A PLC directory failure is a 502: the
// account's identity lives there, not here.
export const hostedBlueskyRouteResponse = async (
  req: NextRequest,
  allowedMethods: HttpMethod[],
  action: () => Promise<unknown>,
  {
    errorStatuses = HOSTED_ERROR_STATUSES
  }: { errorStatuses?: Set<number> } = {}
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
    // Another request holds this account's lock; its message names the DID.
    if (error instanceof PdsLockTimeoutError) {
      return apiResponse({
        req,
        allowedMethods,
        data: {
          error:
            'Another change to this account is still running. Try again shortly.'
        },
        responseStatusCode: 409
      })
    }
    if (error instanceof PdsError) {
      return apiResponse({
        req,
        allowedMethods,
        data: { error: error.message },
        responseStatusCode: errorStatus(error, errorStatuses)
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
