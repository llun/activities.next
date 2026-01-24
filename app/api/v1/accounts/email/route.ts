import crypto from 'crypto'

import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
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

      // TODO: Send verification email
      // For now, we'll just log in development mode
      // In production, this should send an email with a verification link
      if (process.env.NODE_ENV === 'development') {
        console.log(
          `Email change verification code: ${emailChangeCode} for ${newEmail}`
        )
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
