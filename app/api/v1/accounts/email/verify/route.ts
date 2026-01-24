import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const EmailVerifyRequest = z.object({
  emailChangeCode: z.string()
})

export const POST = traceApiRoute(
  'verifyEmailChange',
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

    try {
      const body = await req.json()
      const { emailChangeCode } = EmailVerifyRequest.parse(body)

      const updatedAccount = await database.verifyEmailChange({
        accountId: currentActor.account.id,
        emailChangeCode
      })

      if (!updatedAccount) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Invalid or expired verification code' },
          responseStatusCode: 400
        })
      }

      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          success: true,
          message: 'Email changed successfully',
          email: updatedAccount.email
        },
        responseStatusCode: 200
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Invalid verification code' },
          responseStatusCode: 400
        })
      }
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Failed to verify email change' },
        responseStatusCode: 500
      })
    }
  })
)
