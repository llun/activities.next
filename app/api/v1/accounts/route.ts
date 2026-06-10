import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { registerAccount } from '@/lib/services/accounts/registerAccount'
import {
  OAuthAppGuard,
  corsErrorResponse,
  isBearerAuthorizationHeader
} from '@/lib/services/guards/OAuthGuard'
import { getRedirectUrl } from '@/lib/services/guards/getRedirectUrl'
import { issueAccessToken } from '@/lib/services/oauth/issueAccessToken'
import { Scope } from '@/lib/types/database/operations'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'
import { Booleanish } from '@/lib/utils/zodBooleanish'

import { CreateAccountRequest } from './types'

const MAIN_ERROR_MESSAGE = 'Validation failed'
const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// GET /api/v1/accounts — fetch multiple accounts by id.
// https://docs.joinmastodon.org/methods/accounts/#index
//
// Intentionally public (no OAuthGuard), matching the Mastodon spec which lists
// this index endpoint as public. The single-account endpoint
// (`app/api/v1/accounts/[id]/route.ts`) requires `read` because it also serves
// the authenticated client UI, but the data returned here is the same
// already-public actor profile exposed over ActivityPub, WebFinger, and the
// public profile pages, so requiring auth would diverge from Mastodon without
// protecting anything that is not already public.
export const GET = traceApiRoute(
  'getAccounts',
  async (request: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    const url = new URL(request.url)
    const encodedIds = [
      ...url.searchParams.getAll('id[]'),
      ...url.searchParams.getAll('id')
    ].filter(Boolean)

    if (encodedIds.length === 0) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: []
      })
    }

    const ids = encodedIds.map((encoded) => idToUrl(encoded))
    const accounts = await database.getMastodonActorsFromIds({ ids })

    return apiResponse({
      req: request,
      allowedMethods: CORS_HEADERS,
      data: accounts
    })
  }
)

// Detects a non-bearer Mastodon API client (vs. the HTML web sign-up form). The
// web form is a browser navigation that always sends `Accept: text/html`; any
// request that does not accept HTML — including form-encoded API registrations
// with `Accept: */*` — or that sends a JSON content type is treated as an API
// client. Bearer-authenticated requests are handled separately (real API
// registration), so they are intentionally not matched here. Non-bearer API
// clients are still declined: Mastodon registration needs an app access token,
// which they did not send.
const isApiClient = (request: NextRequest): boolean => {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return true

  const accept = request.headers.get('accept') ?? ''
  return !accept.includes('text/html')
}

// Mastodon's "Register an account" body. Extends the web-form schema (keeping
// the reserved-username and email/password validation) with the API-only
// `agreement`/`locale`/`reason` fields. `agreement` is optional in the schema
// so a missing value yields the dedicated ERR_ACCEPTED error below rather than
// a generic schema failure.
const RegisterApiRequest = CreateAccountRequest.extend({
  agreement: Booleanish.optional(),
  locale: z.string().optional(),
  reason: z.string().max(5000).optional()
})

// POST /api/v1/accounts with a Bearer app token — registers an account and
// returns a user access token bound to it (Mastodon's documented behavior).
// Requires `write:accounts` (satisfied by the aggregate `write`) and an app
// (client_credentials) token: a user-bound token must not mint another
// account's token, so a token carrying an actor is rejected with 403.
const registerViaApi = OAuthAppGuard(
  [Scope.enum['write:accounts']],
  async (req, { client, currentActor, grantedScopes, database }) => {
    if (currentActor || !client) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'This method requires an app access token' },
        responseStatusCode: 403
      })
    }

    let body: Record<string, unknown>
    try {
      body = await getRequestBody(req)
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: MAIN_ERROR_MESSAGE },
        responseStatusCode: 422
      })
    }

    const content = RegisterApiRequest.safeParse(body)
    if (!content.success) {
      const fields = content.error.flatten((issue) => ({
        error: 'ERR_INVALID',
        description: issue.message
      }))
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: MAIN_ERROR_MESSAGE, details: fields },
        responseStatusCode: 422
      })
    }

    const form = content.data
    if (form.agreement !== true) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: {
          error: `${MAIN_ERROR_MESSAGE}: Agreement must be accepted`,
          details: {
            agreement: [
              {
                error: 'ERR_ACCEPTED',
                description: 'Agreement must be accepted'
              }
            ]
          }
        },
        responseStatusCode: 422
      })
    }

    const result = await registerAccount({
      database,
      username: form.username,
      email: form.email,
      password: form.password,
      name: form.name
    })

    if (result.type === 'registration_closed') {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Registration is closed' },
        responseStatusCode: 403
      })
    }

    if (result.type === 'email_not_allowed') {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Email is not allowed to register on this server' },
        responseStatusCode: 403
      })
    }

    if (result.type === 'validation_failed') {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: MAIN_ERROR_MESSAGE, details: result.details },
        responseStatusCode: 422
      })
    }

    // registerAccount returns the new account's actor id (the id OAuthGuard
    // resolves the request actor from), so the issued token authenticates as
    // the freshly created user without an extra lookup.
    const issued = await issueAccessToken({
      database,
      clientId: client.clientId,
      accountId: result.accountId,
      actorId: result.actorId,
      scopes: grantedScopes
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        access_token: issued.token,
        token_type: 'Bearer',
        scope: issued.scopes.join(' '),
        created_at: Math.floor(issued.createdAt / 1000)
      }
    })
  },
  { errorResponse: corsErrorResponse(CORS_HEADERS) }
)

export const POST = traceApiRoute(
  'createAccount',
  async (request: NextRequest, context) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    // A Bearer token marks a Mastodon API registration: validate the app token
    // and return a user access token bound to the new account.
    if (isBearerAuthorizationHeader(request.headers.get('authorization'))) {
      return registerViaApi(request, context)
    }

    // Non-bearer API clients (JSON / non-HTML Accept) can't register: Mastodon
    // requires an app access token, which they did not send. Decline cleanly
    // *before* creating anything — returning the web-form 307 redirect would
    // leave them with an account they cannot authenticate.
    if (isApiClient(request)) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: {
          error: 'Account registration via the API requires an app access token'
        },
        responseStatusCode: 501
      })
    }

    // Guard before parsing the body: a closed server must return 403 even when
    // the body is malformed, preserving the historical response ordering.
    // registerAccount() also checks registrationOpen so it is safe to call as a
    // standalone service; the registration_closed branch in the result handler
    // below is a defensive fallback for that standalone-caller scenario.
    if (!getConfig().registrationOpen) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Registration is closed' },
        responseStatusCode: 403
      })
    }

    // The web sign-up form posts urlencoded/multipart form data.
    let body: Record<string, unknown>
    try {
      body = await getRequestBody(request)
    } catch {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { error: MAIN_ERROR_MESSAGE },
        responseStatusCode: 422
      })
    }
    const content = CreateAccountRequest.safeParse(body)
    if (!content.success) {
      const error = content.error
      const fields = error.flatten((issue) => ({
        error: 'ERR_INVALID',
        description: issue.message
      }))
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { error: MAIN_ERROR_MESSAGE, details: fields },
        responseStatusCode: 422
      })
    }

    const form = content.data
    const result = await registerAccount({
      database,
      username: form.username,
      email: form.email,
      password: form.password,
      name: form.name
    })

    // Defensive fallback: the early gate above normally prevents this branch
    // from being reached in the web-form flow, but registerAccount() re-checks
    // registrationOpen internally for standalone callers. Keeping this branch
    // makes the result-union handler exhaustive and avoids a silent gap if the
    // early gate is ever removed or bypassed.
    if (result.type === 'registration_closed') {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Registration is closed' },
        responseStatusCode: 403
      })
    }

    if (result.type === 'email_not_allowed') {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: {
          error: MAIN_ERROR_MESSAGE,
          details: {
            email: [
              { error: 'ERR_TAKEN', description: 'Email is already taken' }
            ]
          }
        },
        responseStatusCode: 422
      })
    }

    if (result.type === 'validation_failed') {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { error: MAIN_ERROR_MESSAGE, details: result.details },
        responseStatusCode: 422
      })
    }

    return Response.redirect(getRedirectUrl(request, '/auth/signin'), 307)
  }
)
