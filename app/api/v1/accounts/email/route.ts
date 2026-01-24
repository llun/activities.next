import crypto from 'crypto'

import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const EmailChangeRequest = z.object({
  newEmail: z.string().email()
})

export const POST = traceApiRoute(
  'requestEmailChange',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    if (!currentActor.account) {
      return Response.json({ error: 'Account not found' }, { status: 404 })
    }

    try {
      const body = await req.json()
      const { newEmail } = EmailChangeRequest.parse(body)

      // Check if email is already in use
      const existingAccount = await database.getAccountFromEmail({
        email: newEmail
      })
      if (existingAccount && existingAccount.id !== currentActor.account.id) {
        return Response.json(
          { error: 'Email already in use' },
          { status: 400 }
        )
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
        } catch (error) {
          logger.error({ to: newEmail }, 'Failed to send email verification')
          return Response.json(
            { error: 'Failed to send verification email' },
            { status: 500 }
          )
        }
      } else {
        // No email config - log code in development for testing
        if (process.env.NODE_ENV === 'development') {
          console.log(
            `Email change verification code: ${emailChangeCode} for ${newEmail}`
          )
          console.log(
            `Verification URL: https://${config.host}/settings/account/verify-email?code=${emailChangeCode}`
          )
        } else {
          // In production without email config, we cannot complete the flow
          return Response.json(
            {
              error:
                'Email service not configured. Please contact administrator.'
            },
            { status: 503 }
          )
        }
      }

      return Response.json({
        success: true,
        message: 'Verification email sent'
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: 'Invalid email address' },
          { status: 400 }
        )
      }
      console.error('Email change request error:', error)
      return Response.json(
        { error: 'Failed to request email change' },
        { status: 500 }
      )
    }
  })
)
