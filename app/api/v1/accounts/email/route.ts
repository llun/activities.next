import crypto from 'crypto'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'
import { buildChangeEmail } from '@/lib/services/email/templates/changeEmail'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const EmailChangeRequest = z.object({
  // Normalized to lowercase so the "already in use" check and the stored
  // pending email compare against the canonical form. See normalizeEmail.
  newEmail: z.string().trim().toLowerCase().email().max(255)
})

export const POST = traceApiRoute(
  'requestEmailChange',
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

    const parsed = EmailChangeRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }
    const { newEmail } = parsed.data

    try {
      const config = getConfig()
      if (!config.email) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: {
            error: 'Email service not configured. Please contact administrator.'
          },
          responseStatusCode: 500
        })
      }

      // Check if email is already in use
      const existingAccount = await database.getAccountFromEmail({
        email: newEmail
      })
      if (existingAccount && existingAccount.id !== currentActor.account.id) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Email already in use' },
          responseStatusCode: 400
        })
      }

      // Generate verification code
      const emailChangeCode = crypto.randomBytes(32).toString('base64url')

      // Store the pending email change
      await database.requestEmailChange({
        accountId: currentActor.account.id,
        newEmail,
        emailChangeCode
      })

      // Send verification email
      try {
        const email = buildChangeEmail({
          recipientEmail: newEmail,
          emailChangeCode
        })
        await sendMail({
          from: config.email.serviceFromAddress,
          to: [newEmail],
          subject: email.subject,
          content: { text: email.text, html: email.html }
        })
      } catch (error) {
        logger.error({
          message: 'Failed to send email change verification email',
          accountId: currentActor.account.id,
          newEmail,
          err: toLoggableError(error)
        })
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Failed to send verification email' },
          responseStatusCode: 500
        })
      }

      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          success: true,
          message: 'Verification email sent'
        },
        responseStatusCode: 200
      })
    } catch (error) {
      logger.error({
        message: 'Failed to request email change',
        accountId: currentActor.account.id,
        newEmail,
        err: toLoggableError(error)
      })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  })
)
