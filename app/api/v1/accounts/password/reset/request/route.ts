import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { hashPasswordResetCode } from '@/lib/services/auth/passwordResetCode'
import { sendMail } from '@/lib/services/email'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const PasswordResetRequest = z.object({
  email: z.string().email()
})

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
const SUCCESS_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.'

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'requestPasswordReset',
  async (request: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    try {
      const body = await request.json()
      const { email } = PasswordResetRequest.parse(body)
      const config = getConfig()
      const account = await database.getAccountFromEmail({ email })

      if (account) {
        const passwordResetCode = crypto.randomBytes(32).toString('base64url')
        const passwordResetCodeHash = hashPasswordResetCode(passwordResetCode)

        if (config.email) {
          try {
            await sendMail({
              from: config.email.serviceFromAddress,
              to: [email],
              subject: 'Reset your password',
              content: {
                text: `You requested a password reset. Open this link to continue: https://${config.host}/auth/reset-password?code=${passwordResetCode}`,
                html: `
                  <p>You requested a password reset.</p>
                  <p>Open the link below to choose a new password:</p>
                  <p><a href="https://${config.host}/auth/reset-password?code=${passwordResetCode}">Reset Password</a></p>
                  <p>If you did not request this, you can safely ignore this email.</p>
                  <p>This link expires in 24 hours.</p>
                `
              }
            })
          } catch (_error) {
            logger.error({ email }, 'Failed to send password reset email')
            return apiResponse({
              req: request,
              allowedMethods: CORS_HEADERS,
              data: { error: 'Failed to send password reset email' },
              responseStatusCode: 500
            })
          }
        } else {
          logger.warn(
            { email },
            'Password reset requested but email service is not configured'
          )
        }

        await database.requestPasswordReset({
          email,
          passwordResetCode: passwordResetCodeHash
        })
      }

      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { success: true, message: SUCCESS_MESSAGE },
        responseStatusCode: 200
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return apiResponse({
          req: request,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Invalid email address' },
          responseStatusCode: 400
        })
      }

      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Failed to request password reset' },
        responseStatusCode: 500
      })
    }
  }
)
