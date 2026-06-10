// POST /api/v1/emails/confirmations — resend the confirmation email for an
// account that has not confirmed yet. 403 once confirmed, per Mastodon.
import crypto from 'crypto'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { sendMail } from '@/lib/services/email'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import { HTTP_STATUS, apiCorsError, apiResponse } from '@/lib/utils/response'
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
      return apiCorsError(req, [], HTTP_STATUS.NOT_FOUND)
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

    // Optional `email` param updates the pending address before resending.
    if (newEmail && newEmail !== account.email) {
      const emailChangeCode = crypto.randomBytes(32).toString('base64url')
      await database.requestEmailChange({
        accountId: account.id,
        newEmail,
        emailChangeCode
      })
    }

    const config = getConfig()
    if (config.email) {
      const recipient = newEmail ?? account.email
      try {
        await sendMail({
          from: config.email.serviceFromAddress,
          to: [recipient],
          subject: 'Email verification',
          content: {
            text: `Open this link to verify your email https://${config.host}/auth/confirmation?verificationCode=${account.verificationCode}`,
            html: `Open <a href="https://${config.host}/auth/confirmation?verificationCode=${account.verificationCode}">this link</a> to verify your email.`
          }
        })
      } catch {
        logger.error({ to: recipient }, `Fail to send email`)
      }
    }

    return apiResponse({
      req,
      allowedMethods: [],
      data: {},
      responseStatusCode: HTTP_STATUS.OK
    })
  })
)
