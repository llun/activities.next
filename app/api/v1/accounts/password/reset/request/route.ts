import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { hashPasswordResetCode } from '@/lib/services/auth/passwordResetCode'
import { sendMail } from '@/lib/services/email'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const PasswordResetRequest = z.object({ email: z.string().email() })

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
const SUCCESS_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.'

export const OPTIONS = defaultOptions(CORS_HEADERS)

const passwordResetSuccessResponse = (req: NextRequest) =>
  apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: { success: true, message: SUCCESS_MESSAGE },
    responseStatusCode: 200
  })

export const POST = traceApiRoute(
  'requestPasswordReset',
  async (request: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    try {
      const body = await request.json()
      const parsed = PasswordResetRequest.safeParse(body)
      if (!parsed.success) {
        return passwordResetSuccessResponse(request)
      }
      const { email } = parsed.data
      const config = getConfig()
      const account = await database.getAccountFromEmail({ email })

      if (account) {
        if (!config.email) {
          logger.warn(
            { email },
            'Password reset requested but email service is not configured'
          )
          return passwordResetSuccessResponse(request)
        }

        const passwordResetCode = crypto.randomBytes(32).toString('base64url')
        const passwordResetCodeHash = hashPasswordResetCode(passwordResetCode)
        const previousPasswordResetCode = account.passwordResetCode ?? null
        const previousPasswordResetCodeExpiresAt =
          account.passwordResetCodeExpiresAt ?? null

        const saved = await database.requestPasswordReset({
          email,
          passwordResetCode: passwordResetCodeHash
        })
        if (!saved) {
          logger.error(
            { email },
            'Password reset code persistence failed for existing account'
          )
          return passwordResetSuccessResponse(request)
        }

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
          try {
            const restored = await database.requestPasswordReset({
              email,
              passwordResetCode: previousPasswordResetCode,
              ...(previousPasswordResetCodeExpiresAt !== null
                ? { expiresAt: previousPasswordResetCodeExpiresAt }
                : null)
            })
            if (!restored) {
              logger.error(
                { email },
                'Failed to restore previous password reset code'
              )
              return apiResponse({
                req: request,
                allowedMethods: CORS_HEADERS,
                data: ERROR_500,
                responseStatusCode: 500
              })
            }
          } catch (error) {
            logger.error(
              { email, error },
              'Failed to restore previous password reset code'
            )
            return apiResponse({
              req: request,
              allowedMethods: CORS_HEADERS,
              data: ERROR_500,
              responseStatusCode: 500
            })
          }
          return passwordResetSuccessResponse(request)
        }
      }

      return passwordResetSuccessResponse(request)
    } catch (error) {
      logger.error({ error }, 'Failed to request password reset')
      return passwordResetSuccessResponse(request)
    }
  }
)
