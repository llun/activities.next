import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const EmailVerifyRequest = z.object({
  emailChangeCode: z.string()
})

export const POST = traceApiRoute(
  'verifyEmailChange',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    if (!currentActor.account) {
      return Response.json({ error: 'Account not found' }, { status: 404 })
    }

    try {
      const body = await req.json()
      const { emailChangeCode } = EmailVerifyRequest.parse(body)

      const updatedAccount = await database.verifyEmailChange({
        accountId: currentActor.account.id,
        emailChangeCode
      })

      if (!updatedAccount) {
        return Response.json(
          { error: 'Invalid or expired verification code' },
          { status: 400 }
        )
      }

      return Response.json({
        success: true,
        message: 'Email changed successfully',
        email: updatedAccount.email
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: 'Invalid verification code' },
          { status: 400 }
        )
      }
      console.error('Email verification error:', error)
      return Response.json(
        { error: 'Failed to verify email change' },
        { status: 500 }
      )
    }
  })
)
