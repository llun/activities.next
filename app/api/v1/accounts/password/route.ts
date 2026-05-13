import bcrypt from 'bcrypt'
import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const PasswordChangeRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
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
    const { currentPassword, newPassword } = parsed.data

    try {
      // Verify current password
      const isPasswordCorrect = await bcrypt.compare(
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
      const newPasswordHash = await bcrypt.hash(newPassword, 10)

      // Update password
      await database.changePassword({
        accountId: currentActor.account.id,
        newPasswordHash
      })

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
