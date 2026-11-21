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
  // Required when the account has a password (see the handler); a passkey- or
  // OAuth-only account has none to prove.
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

    const rateLimit = checkEmailChangeRateLimit(currentActor.account.id)
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

      // A password account must prove the current password: a hijacked session
      // alone must not be able to move the address (and then reset the
      // password through it). A passkey- or OAuth-only account has no password
      // to prove, so it keeps the session-only behaviour.
      if (currentActor.account.passwordHash) {
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

      // Store the pending email change
      await database.requestEmailChange({
        accountId: currentActor.account.id,
        newEmail,
        emailChangeCode
      })

      // Linked on the account's actor domain when this server answers on it.
      const domain = getServedLinkDomain(currentActor.domain)
      const { brand, from, contactEmail } = await resolveEmailIdentity(
        database,
        domain
      )

      // Tell the OLD address, so its owner learns about a change they did not
      // ask for. A failure here must not fail the request: the change is
      // already pending and the new address still gets its link.
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
