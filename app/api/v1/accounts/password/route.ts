import { z } from 'zod'

import { comparePassword, hashPassword } from '@/lib/services/auth/passwordHash'
import { checkPasswordChangeRateLimit } from '@/lib/services/auth/routeRateLimits'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiRateLimitedResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const PasswordChangeRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
  // Signing connected apps out is the default: a password change is the
  // moment to end tokens an attacker may hold. The settings form lets the
  // owner keep them.
  signOutApps: z.boolean().default(true)
})

export const POST = traceApiRoute(
  'changePassword',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    if (!currentActor.account) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Account not found' },
        responseStatusCode: 404
      })
    }

    const rateLimit = checkPasswordChangeRateLimit(currentActor.account.id)
    if (!rateLimit.allowed) {
      return apiRateLimitedResponse(req, rateLimit.retryAfterSeconds)
    }

    if (!currentActor.account.passwordHash) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Password not set for this account' },
        responseStatusCode: 400
      })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch (_error) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = PasswordChangeRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }
    const { currentPassword, newPassword, signOutApps } = parsed.data

    try {
      // Verify current password
      const isPasswordCorrect = await comparePassword(
        currentPassword,
        currentActor.account.passwordHash
      )

      if (!isPasswordCorrect) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Current password is incorrect' },
          responseStatusCode: 400
        })
      }

      // Hash new password
      const newPasswordHash = await hashPassword(newPassword)

      // Update password. The write matches the hash verified above, so a reset
      // that landed in between makes it match nothing: report the conflict
      // instead of overwriting the reset's password.
      const changed = await database.changePassword({
        accountId: currentActor.account.id,
        newPasswordHash,
        expectedPasswordHash: currentActor.account.passwordHash,
        signOutApps
      })
      if (!changed) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: {
            error:
              'Your password changed while this request was in progress. Please try again.'
          },
          responseStatusCode: 409
        })
      }

      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          success: true,
          message: 'Password changed successfully'
        },
        responseStatusCode: 200
      })
    } catch (error) {
      logger.error({
        message: 'Failed to change password',
        accountId: currentActor.account.id,
        error
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  })
)
