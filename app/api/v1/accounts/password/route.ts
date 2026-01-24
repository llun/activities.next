import bcrypt from 'bcrypt'
import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const PasswordChangeRequest = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8)
})

export const POST = traceApiRoute(
  'changePassword',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    if (!currentActor.account) {
      return Response.json({ error: 'Account not found' }, { status: 404 })
    }

    if (!currentActor.account.passwordHash) {
      return Response.json(
        { error: 'Password not set for this account' },
        { status: 400 }
      )
    }

    try {
      const body = await req.json()
      const { currentPassword, newPassword } = PasswordChangeRequest.parse(body)

      // Verify current password
      const isPasswordCorrect = await bcrypt.compare(
        currentPassword,
        currentActor.account.passwordHash
      )

      if (!isPasswordCorrect) {
        return Response.json(
          { error: 'Current password is incorrect' },
          { status: 400 }
        )
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 10)

      // Update password
      await database.changePassword({
        accountId: currentActor.account.id,
        newPasswordHash
      })

      return Response.json({
        success: true,
        message: 'Password changed successfully'
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: 'Invalid password format' },
          { status: 400 }
        )
      }
      console.error('Password change error:', error)
      return Response.json(
        { error: 'Failed to change password' },
        { status: 500 }
      )
    }
  })
)
