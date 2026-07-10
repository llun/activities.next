import { getProfileHandler } from '@/lib/services/accounts/profileHandler'
import { updateCredentialsHandler } from '@/lib/services/accounts/updateCredentialsHandler'
import { HttpMethod } from '@/lib/utils/http-headers'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PATCH
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// GET /api/v1/profile — view the current actor's Profile entity (raw field
// values, nullable avatar/header).
// https://docs.joinmastodon.org/methods/profile/#get
// Scope: `profile` or read:accounts (satisfied by the aggregate `read`).
export const GET = traceApiRoute('getProfile', getProfileHandler(CORS_HEADERS))

// PATCH /api/v1/profile — update the current actor's profile (same param
// handling as update_credentials plus the 4.6 appearance params) and return
// the updated Profile entity.
// https://docs.joinmastodon.org/methods/profile/#update
// Scope: write:accounts (satisfied by the aggregate `write`).
export const PATCH = traceApiRoute(
  'patchProfile',
  updateCredentialsHandler(CORS_HEADERS, { responseEntity: 'profile' })
)
