import bcrypt from 'bcrypt'
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { hashPasswordResetCode } from '@/lib/services/auth/passwordResetCode'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ResetPasswordRequest = z.object({
  code: z.string().min(1),
  newPassword: z.string().min(8)
})

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'resetPassword',
  async (request: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    try {
      const body = await request.json()
      const { code, newPassword } = ResetPasswordRequest.parse(body)
      const passwordResetCode = hashPasswordResetCode(code)
      const isValidCode = await database.validatePasswordResetCode({
        passwordResetCode
      })

      if (!isValidCode) {
        return apiResponse({
          req: request,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid or expired reset code' },
          responseStatusCode: 400
        })
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 10)

      const account = await database.resetPasswordWithCode({
        passwordResetCode,
        newPasswordHash
      })

      if (!account) {
        return apiResponse({
          req: request,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid or expired reset code' },
          responseStatusCode: 400
        })
      }

      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { success: true, message: 'Password reset successfully' },
        responseStatusCode: 200
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return apiResponse({
          req: request,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid password format' },
          responseStatusCode: 400
        })
      }

      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Failed to reset password' },
        responseStatusCode: 500
      })
    }
  }
)
