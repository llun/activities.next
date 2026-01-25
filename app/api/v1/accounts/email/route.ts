import crypto from 'crypto'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const EmailChangeRequest = z.object({
  newEmail: z.string().email()
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

    try {
      const body = await req.json()
      const { newEmail } = EmailChangeRequest.parse(body)

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
      const config = getConfig()
      if (config.email) {
        try {
          await sendMail({
            from: config.email.serviceFromAddress,
            to: [newEmail],
            subject: 'Verify your new email address',
            content: {
              text: `You requested to change your email address. Please verify your new email by opening this link: https://${config.host}/settings/account/verify-email?code=${emailChangeCode}`,
              html: `
                <p>You requested to change your email address.</p>
                <p>Please verify your new email by clicking the link below:</p>
                <p><a href="https://${config.host}/settings/account/verify-email?code=${emailChangeCode}">Verify Email Address</a></p>
                <p>If you didn't request this change, you can safely ignore this email.</p>
                <p>This link will expire in 24 hours.</p>
              `
            }
          })
        } catch (_error) {
          return apiResponse({
            req,
            allowedMethods: [],
            data: { error: 'Failed to send verification email' },
            responseStatusCode: 500
          })
        }
      } else {
        // No email config - in production this is an error
        if (process.env.NODE_ENV !== 'development') {
          return apiResponse({
            req,
            allowedMethods: [],
            data: {
              error:
                'Email service not configured. Please contact administrator.'
            },
            responseStatusCode: 500
          })
        }
        // In development mode, return success but indicate email sending is skipped
        // Users should check server logs for the verification code
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
      if (error instanceof z.ZodError) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Invalid email address' },
          responseStatusCode: 400
        })
      }
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Failed to request email change' },
        responseStatusCode: 500
      })
    }
  })
)
