// POST /api/v1/emails/confirmations — resend the confirmation email for an
// account that has not confirmed yet. 403 once confirmed, per Mastodon.
//
// This is a Mastodon-facing endpoint: a client that just registered via
// `POST /api/v1/accounts` holds a fresh Bearer access token and uses it here to
// resend (or redirect) its confirmation email. It therefore authenticates with
// OAuthGuard (Bearer token, with a cookie-session fallback for the web UI) and
// requires a `write` scope, rather than the cookie-only AuthenticatedGuard.
import crypto from 'node:crypto'
import { z } from 'zod'

import { isUniqueConstraintError } from '@/lib/database/sql/utils/isUniqueConstraintError'
import { sendConfirmationEmail } from '@/lib/services/accounts/sendConfirmationEmail'
import { isAccountConfirmationPending } from '@/lib/services/auth/canCreateSessionForAccount'
import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { Scope } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { isEmailAllowed } from '@/lib/utils/normalizeEmail'
import { HTTP_STATUS, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

// The one endpoint an account awaiting confirmation must still reach: it is
// how that account gets its confirmation e-mail resent, so refusing it for
// being unconfirmed makes the state unrecoverable. Mastodon carves out the
// same endpoint — `Api::V1::Emails::ConfirmationsController` never calls
// `require_user!`. The opt-out relaxes the confirmation test only: a suspended
// actor or a disabled account is still refused here, and the handler below
// still requires a pending `verificationCode`, so a confirmed account gets 403
// rather than a pointless resend.
const guardOptions = {
  errorResponse: corsErrorResponse(CORS_HEADERS),
  allowUnconfirmedAccount: true
}

export const OPTIONS = defaultOptions(CORS_HEADERS)

// `.max(255)` matches the accounts.email column width so an over-long address
// fails validation here rather than at the DB insert (a 500).
const ConfirmationRequest = z.object({
  // Normalized to lowercase so the allow-list check, the duplicate-email check,
  // and the stored address all use the canonical form. See normalizeEmail.
  email: z.string().trim().toLowerCase().email().max(255).optional()
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

      // The SAME predicate the guards, `canCreateSessionForAccount`, the admin
      // `confirmed` field and the OIDC claim use — deliberately not the raw
      // `verificationCode` column this used to read.
      //
      // The two disagree for the cohort `20260320072514_better_auth_columns`
      // marked verified while their code stayed set, and on an instance where
      // `20260828140000` skipped (it runs in the same pass as that backfill on
      // a pre-March restore, staging copy or catch-up, and nothing re-runs it)
      // that disagreement is permanent. Reading the raw column made this route
      // treat such an account as awaiting confirmation while every other
      // surface treated it as confirmed — and this route is bearer-reachable
      // with `write`, while the flow that actually PROVES a new address
      // (`POST /api/v1/accounts/email`) is cookie-and-same-origin only. So an
      // ordinary Mastodon client token could re-point a confirmed account's
      // address to one it controls, locking the owner out of sign-in and every
      // guard, receiving the fresh code, and taking the account over through
      // password reset. Mastodon gates its own equivalent on the same question
      // — `Api::V1::Emails::ConfirmationsController` applies
      // `require_user_not_confirmed!` — so a confirmed account cannot re-point
      // through it there either.
      //
      // A genuinely pending account is unaffected: `code && !emailVerified` is
      // still true for it.
      if (!isAccountConfirmationPending(account)) {
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

      // A malformed `email` param is a client error: return 422 with field
      // details (like the registration endpoints) rather than silently dropping
      // it and resending to the old address. An absent `email` still parses
      // successfully (it is optional) and resends to the current address.
      const parsed = ConfirmationRequest.safeParse(body)
      if (!parsed.success) {
        const { fieldErrors } = parsed.error.flatten((issue) => ({
          error: 'ERR_INVALID',
          description: issue.message
        }))
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: 'Validation failed', details: fieldErrors },
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }
      const newEmail = parsed.data.email

      // Optional `email` param updates the unconfirmed account's address
      // directly before resending. (This is distinct from the confirmed-user
      // email-change flow in accounts/email, which uses the pending-change
      // machinery.)
      //
      // The code is ROTATED with the address rather than carried across, and
      // so is every other proof about the old one — see
      // `RepointUnconfirmedAccountEmailParams` for why.
      //
      //
      // Rotation happens only where the address actually CHANGES, which is the
      // same condition that performs the write. A plain resend to the same
      // address stores nothing, so rotating there would mail a code the row
      // does not hold and turn every resend into a dead link.
      //
      // `verificationCode` starts as the stored one and is reassigned only
      // inside that branch, immediately beside the write that persists it —
      // the value sent and the value stored are the same binding, so they
      // cannot drift apart.
      let verificationCode = account.verificationCode
      if (newEmail && newEmail !== account.email) {
        // Honor the server's allow-list so the email param can't be used to
        // sidestep the same restriction enforced at registration.
        const { registrations } = await getResolvedServerSettings(database)
        if (!isEmailAllowed(registrations.allowEmails, newEmail)) {
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

        try {
          verificationCode = crypto.randomBytes(32).toString('base64url')
          await database.repointUnconfirmedAccountEmail({
            accountId: account.id,
            email: newEmail,
            verificationCode
          })
        } catch (error) {
          // The pre-check above covers the common case, but a concurrent
          // claim of the same address can still race onto the unique
          // constraint; map that to 422 rather than a 500.
          if (isUniqueConstraintError(error)) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: { error: 'Email is already taken' },
              responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
            })
          }
          throw error
        }
      }

      const recipient = newEmail ?? account.email
      try {
        await sendConfirmationEmail({
          recipient,
          verificationCode
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
