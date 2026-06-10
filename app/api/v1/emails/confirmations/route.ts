// POST /api/v1/emails/confirmations — resend the confirmation email for an
// account that has not confirmed yet. 403 once confirmed, per Mastodon.
import { z } from 'zod'

import { sendConfirmationEmail } from '@/lib/services/accounts/sendConfirmationEmail'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import { HTTP_STATUS, apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ConfirmationRequest = z.object({
  email: z.string().email().optional()
})

export const POST = traceApiRoute(
  'resendEmailConfirmation',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const account = currentActor.account

    if (!account) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Account not found' },
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    }

    // `verificationCode` is the pending-confirmation token set at registration
    // when email is configured; it is cleared (to '') once the account verifies.
    // An empty/null code means the e-mail is already confirmed.
    if (!account.verificationCode) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: {
          error:
            'This method is only available while the e-mail is awaiting confirmation'
        },
        responseStatusCode: HTTP_STATUS.FORBIDDEN
      })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const parsed = ConfirmationRequest.safeParse(body)
    const newEmail = parsed.success ? parsed.data.email : undefined

    // Optional `email` param updates the unconfirmed account's address directly
    // before resending. Because the account is still unconfirmed we just point
    // the existing verificationCode at the new address — verifyAccount then
    // confirms the new email when the link is clicked. (This is distinct from
    // the confirmed-user email-change flow in accounts/email, which uses the
    // pending-change machinery.)
    if (newEmail && newEmail !== account.email) {
      await database.updateAccountEmail({
        accountId: account.id,
        email: newEmail
      })
    }

    const recipient = newEmail ?? account.email
    try {
      await sendConfirmationEmail({
        recipient,
        verificationCode: account.verificationCode
      })
    } catch {
      logger.error({ to: recipient }, `Fail to send email`)
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'Failed to send verification email' },
        responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
      })
    }

    return apiResponse({
      req,
      allowedMethods: [],
      data: {},
      responseStatusCode: HTTP_STATUS.OK
    })
  })
)
