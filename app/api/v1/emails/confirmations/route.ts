// POST /api/v1/emails/confirmations — resend the confirmation email for an
// account that has not confirmed yet. 403 once confirmed, per Mastodon.
//
// This is a Mastodon-facing endpoint: a client that just registered via
// `POST /api/v1/accounts` holds a fresh Bearer access token and uses it here to
// resend (or redirect) its confirmation email. It therefore authenticates with
// OAuthGuard (Bearer token, with a cookie-session fallback for the web UI) and
// requires a `write` scope, rather than the cookie-only AuthenticatedGuard.
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { sendConfirmationEmail } from '@/lib/services/accounts/sendConfirmationEmail'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { HTTP_STATUS, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

export const OPTIONS = defaultOptions(CORS_HEADERS)

// `.max(255)` matches the accounts.email column width so an over-long address
// fails validation here rather than at the DB insert (a 500).
const ConfirmationRequest = z.object({
  email: z.string().email().max(255).optional()
})

// Scope write:accounts (satisfied by aggregate `write`), matching the other
// account-mutating Mastodon endpoints.
export const POST = traceApiRoute(
  'resendEmailConfirmation',
  OAuthGuardAnyScope(
    [Scope.enum.write, Scope.enum['write:accounts']],
    async (req, context) => {
      const { currentActor, database } = context
      const account = currentActor.account

      if (!account) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Account not found' },
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      }

      // `verificationCode` is the pending-confirmation token set at registration
      // when email is configured; it is cleared (to '') once the account
      // verifies. An empty/null code means the e-mail is already confirmed.
      if (!account.verificationCode) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            error:
              'This method is only available while the e-mail is awaiting confirmation'
          },
          responseStatusCode: HTTP_STATUS.FORBIDDEN
        })
      }

      // Parse with getRequestBody (JSON + urlencoded + multipart) so a client
      // posting `email` as form data — like the registration endpoint accepts —
      // is honored rather than silently dropped by a JSON-only parse.
      let body: Record<string, unknown>
      try {
        body = await getRequestBody(req)
      } catch {
        body = {}
      }

      const parsed = ConfirmationRequest.safeParse(body)
      const newEmail = parsed.success ? parsed.data.email : undefined

      // Optional `email` param updates the unconfirmed account's address
      // directly before resending. Because the account is still unconfirmed we
      // just point the existing verificationCode at the new address —
      // verifyAccount then confirms the new email when the link is clicked.
      // (This is distinct from the confirmed-user email-change flow in
      // accounts/email, which uses the pending-change machinery.)
      if (newEmail && newEmail !== account.email) {
        // Honor the server's allow-list so the email param can't be used to
        // sidestep the same restriction enforced at registration.
        const { allowEmails } = getConfig()
        if (allowEmails.length && !allowEmails.includes(newEmail)) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { error: 'Email is not allowed on this server' },
            responseStatusCode: HTTP_STATUS.FORBIDDEN
          })
        }

        // Guard against the unique-email constraint: updating to an address
        // already registered by another account would throw at the DB layer and
        // surface as a 500. Reject with 422 instead.
        const isEmailTaken = await database.isAccountExists({ email: newEmail })
        if (isEmailTaken) {
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { error: 'Email is already taken' },
            responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
          })
        }

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
          allowedMethods: CORS_HEADERS,
          data: { error: 'Failed to send verification email' },
          responseStatusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR
        })
      }

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {},
        responseStatusCode: HTTP_STATUS.OK
      })
    },
    guardOptions
  )
)
