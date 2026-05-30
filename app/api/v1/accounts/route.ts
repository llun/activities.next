import * as bcrypt from 'bcrypt'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { sendMail } from '@/lib/services/email'
import { getRedirectUrl } from '@/lib/services/guards/getRedirectUrl'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { ERROR_500, apiResponse, defaultOptions } from '@/lib/utils/response'
import { generateKeyPair } from '@/lib/utils/signature'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

import { CreateAccountRequest } from './types'

const BCRYPT_ROUND = 10
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

// Detects a Mastodon API client (vs. the HTML web sign-up form). The web form
// is a browser navigation that always sends `Accept: text/html`; any request
// that does not accept HTML — including form-encoded API registrations with
// `Accept: */*` — is treated as an API client, as is anything sending a Bearer
// token or a JSON content type. API clients are declined before any account is
// created, since the registration Token response is not implemented.
const isApiClient = (request: NextRequest): boolean => {
  const authorization = request.headers.get('authorization') ?? ''
  if (/^bearer\s/i.test(authorization.trim())) return true

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return true

  const accept = request.headers.get('accept') ?? ''
  return !accept.includes('text/html')
}

export const POST = traceApiRoute(
  'createAccount',
  async (request: NextRequest) => {
    const config = getConfig()
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: ERROR_500,
        responseStatusCode: 500
      })
    }

    // Mastodon's "Register an account" returns a Token bound to an OAuth app.
    // Minting a real access token requires the authorization-code flow (and the
    // account is unverified at creation), so it is not implemented here. Decline
    // API clients cleanly *before* creating anything — returning the web-form
    // 307 redirect would leave them with an account they cannot authenticate and
    // cannot re-create (username/email already taken).
    if (isApiClient(request)) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: {
          error: 'Account registration via the API is not supported'
        },
        responseStatusCode: 501
      })
    }

    const { host: domain, allowEmails } = config
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
    if (allowEmails.length && !allowEmails.includes(form.email)) {
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

    const [isAccountExists, isUsernameExists] = await Promise.all([
      database.isAccountExists({ email: form.email }),
      database.isUsernameExists({ username: form.username, domain })
    ])

    const errorDetails: {
      [key in 'email' | 'username']?: { error: string; description: string }[]
    } = {}
    if (isAccountExists) {
      errorDetails.email = [
        { error: 'ERR_TAKEN', description: 'Email is already taken' }
      ]
    }

    if (isUsernameExists) {
      errorDetails.username = [
        { error: 'ERR_TAKEN', description: 'Username is already taken' }
      ]
    }
    if (Object.keys(errorDetails).length > 0) {
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: { error: MAIN_ERROR_MESSAGE, details: errorDetails },
        responseStatusCode: 422
      })
    }

    // TODO: If the request has auth bearer, return 200 instead
    const [keyPair, passwordHash] = await Promise.all([
      generateKeyPair(config.secretPhase),
      bcrypt.hash(form.password, BCRYPT_ROUND)
    ])

    const verificationCode = config.email
      ? crypto.randomBytes(32).toString('base64url')
      : null

    await database.createAccount({
      domain,
      email: form.email,
      username: form.username,
      name: form.name || null,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      passwordHash,
      verificationCode
    })

    if (config.email) {
      try {
        await sendMail({
          from: config.email.serviceFromAddress,
          to: [form.email],
          subject: 'Email verification',
          content: {
            text: `Open this link to verify your email https://${config.host}/auth/confirmation?verificationCode=${verificationCode}`,
            html: `Open <a href="https://${config.host}/auth/confirmation?verificationCode=${verificationCode}">this link</a> to verify your email.`
          }
        })
      } catch {
        logger.error({ to: form.email }, `Fail to send email`)
      }
    }

    return Response.redirect(getRedirectUrl(request, '/auth/signin'), 307)
  }
)
