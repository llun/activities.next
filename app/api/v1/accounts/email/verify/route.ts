import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
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
      let body: unknown
      try {
        body = await req.json()
      } catch (_error) {
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }

      const parsed = EmailVerifyRequest.safeParse(body)
      if (!parsed.success) {
        return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
      }
      const { emailChangeCode } = parsed.data

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
    } catch (_error) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Failed to verify email change' },
        responseStatusCode: 500
      })
    }
  })
)
