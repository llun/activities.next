import bcrypt from 'bcrypt'
import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiResponse } from '@/lib/utils/response'
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

    try {
      const body = await req.json()
      const { currentPassword, newPassword } = PasswordChangeRequest.parse(body)

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
      if (error instanceof z.ZodError) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Invalid password format' },
          responseStatusCode: 400
        })
      }
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Failed to change password' },
        responseStatusCode: 500
      })
    }
  })
)
