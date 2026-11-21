import crypto from 'crypto'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { comparePassword } from '@/lib/services/auth/passwordHash'
import { hashPasswordResetCode } from '@/lib/services/auth/passwordResetCode'
import {
  checkEmailChangeRateLimit,
  checkPasswordChangeRateLimit
} from '@/lib/services/auth/routeRateLimits'
import { getServedLinkDomain } from '@/lib/services/domains/localDomains'
import { sendMail } from '@/lib/services/email'
import { resolveEmailIdentity } from '@/lib/services/email/sender'
import { buildChangeEmail } from '@/lib/services/email/templates/changeEmail'
import { buildEmailChangeNoticeEmail } from '@/lib/services/email/templates/emailChangeNotice'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiRateLimitedResponse,
  apiResponse
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const EmailChangeRequest = z.object({
  // Normalized to lowercase so the "already in use" check and the stored
  // pending email compare against the canonical form. See normalizeEmail.
  newEmail: z.string().trim().toLowerCase().email().max(255),
  // Always required: an account without a password cannot change its address
  // (see the handler), so every request proves the current password.
  currentPassword: z.string().min(1).optional()
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

    const rateLimit = await checkEmailChangeRateLimit(
      currentActor.account.id
    ).catch((error) => {
      logger.error(
        { err: toLoggableError(error) },
        'Failed to check the email change rate limit'
      )
      return null
    })
    if (!rateLimit) {
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
    if (!rateLimit.allowed) {
      return apiRateLimitedResponse(req, rateLimit.retryAfterSeconds)
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
    const { newEmail, currentPassword } = parsed.data

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

      // An account without a password cannot change its address: the new
      // mailbox alone would confirm the change, so a stolen session could take
      // over recovery. It must set a password first through "Forgot password",
      // which mails the current address.
      if (!currentActor.account.passwordHash) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: {
            error:
              'Set a password before changing your email address. Use "Forgot password" to set one; the link is sent to your current address.'
          },
          responseStatusCode: 400
        })
      }

      // A password account must prove the current password: a hijacked session
      // alone must not be able to move the address (and then reset the
      // password through it).
      const passwordLimit = checkPasswordChangeRateLimit(
        currentActor.account.id
      )
      if (!passwordLimit.allowed) {
        return apiRateLimitedResponse(req, passwordLimit.retryAfterSeconds)
      }
      if (!currentPassword) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Current password is required' },
          responseStatusCode: 400
        })
      }
      const isPasswordCorrect = await comparePassword(
        currentPassword,
        currentActor.account.passwordHash
      )
      if (!isPasswordCorrect) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'Current password is incorrect' },
          responseStatusCode: 400
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

      // The link carries the raw code; the database stores only its HMAC, the
      // same way a password reset code is stored.
      const rawEmailChangeCode = crypto.randomBytes(32).toString('base64url')
      const emailChangeCode = hashPasswordResetCode(rawEmailChangeCode)

      // Store the pending email change. The write matches the password hash
      // verified above, so a reset that landed in between makes it match
      // nothing: report the conflict and send no mail.
      const saved = await database.requestEmailChange({
        accountId: currentActor.account.id,
        newEmail,
        emailChangeCode,
        expectedPasswordHash: currentActor.account.passwordHash
      })
      if (!saved) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: {
            error:
              'Your password changed while this request was in progress. Please try again.'
          },
          responseStatusCode: 409
        })
      }

      // Linked on the account's actor domain when this server answers on it.
      const domain = getServedLinkDomain(currentActor.domain)
      const { brand, from, contactEmail } = await resolveEmailIdentity(
        database,
        domain
      )

      // Send verification email
      try {
        const email = buildChangeEmail({
          recipientEmail: newEmail,
          emailChangeCode: rawEmailChangeCode,
          domain,
          brand
        })
        await sendMail({
          from,
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

      // Then tell the OLD address, so its owner learns about a change they did
      // not ask for. It goes second so it never claims a link that failed to
      // send, and a failure here must not fail the request: the change is
      // pending and the new address already has its link.
      try {
        const notice = buildEmailChangeNoticeEmail({
          recipientEmail: currentActor.account.email,
          newEmail,
          contactEmail,
          brand
        })
        await sendMail({
          from,
          to: [currentActor.account.email],
          subject: notice.subject,
          content: { text: notice.text, html: notice.html }
        })
      } catch (error) {
        logger.error({
          message: 'Failed to send email change notice to the old address',
          accountId: currentActor.account.id,
          err: toLoggableError(error)
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
