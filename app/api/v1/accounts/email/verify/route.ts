import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
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

    try {
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
      logger.error({
        message: 'Failed to verify email change',
        accountId: currentActor.account.id,
        error
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  })
)
