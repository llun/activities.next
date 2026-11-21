import { NextRequest } from 'next/server'

import { getDatabase } from '@/lib/database'
import {
  hashPasswordResetCode,
  isGeneratedCodeShape
} from '@/lib/services/auth/passwordResetCode'
import { checkEmailConfirmationIpRateLimit } from '@/lib/services/auth/routeRateLimits'
import { hasSameOriginProof } from '@/lib/services/guards/sameOriginProof'
import {
  SMALL_REQUEST_BODY_MAX_BYTES,
  isRequestBodyTooLargeError
} from '@/lib/utils/boundedRequestBody'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiRateLimitedResponse
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

// The email-change link opens `/account/verify-email`, whose GET is read-only.
// This route performs the change when the reader presses the page's confirm
// button. It is code-based rather than session-based (the link may be opened
// signed out), so the code is the credential and same-origin proof is the CSRF
// guard.
//
// The Location is root-relative: the browser resolves it against the host it
// already reached, so a forwarded or proxied request cannot be redirected to
// another origin.
const redirectTo = (status: 'verified' | 'invalid') =>
  new Response(null, {
    status: 303,
    headers: { Location: `/account/verify-email?status=${status}` }
  })

export const POST = traceApiRoute(
  'confirmEmailChange',
  async (req: NextRequest) => {
    if (!hasSameOriginProof(req)) {
      return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
    }

    const rateLimit = await checkEmailConfirmationIpRateLimit(req).catch(
      (error) => {
        logger.error(
          { err: toLoggableError(error) },
          'Failed to check the email confirmation rate limit'
        )
        return null
      }
    )
    if (!rateLimit) {
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
    if (!rateLimit.allowed) {
      return apiRateLimitedResponse(req, rateLimit.retryAfterSeconds)
    }

    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }

    // The native form posts `application/x-www-form-urlencoded`; a client may
    // send multipart. Read through the bounded helper so an unauthenticated
    // caller cannot make the route buffer an arbitrarily large body.
    let body: Record<string, unknown>
    try {
      body = await getRequestBody(req, {
        maxBytes: SMALL_REQUEST_BODY_MAX_BYTES
      })
    } catch (error) {
      if (isRequestBodyTooLargeError(error)) {
        return apiErrorResponse(HTTP_STATUS.PAYLOAD_TOO_LARGE)
      }
      return redirectTo('invalid')
    }

    const value = body.code
    const code = typeof value === 'string' ? value : null
    // A malformed code cannot match a stored one, so reject it before any
    // database call.
    if (!code || !isGeneratedCodeShape(code)) return redirectTo('invalid')

    try {
      const account = await database.verifyEmailChange({
        // The link carries the raw code; the row stores its HMAC.
        emailChangeCode: hashPasswordResetCode(code)
      })
      return redirectTo(account ? 'verified' : 'invalid')
    } catch (error) {
      logger.error({
        message: 'Failed to confirm email change',
        err: toLoggableError(error)
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  }
)
