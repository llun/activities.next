import { getCredentialAccountHandler } from '@/lib/services/accounts/credentialsHandler'
import { HttpMethod } from '@/lib/utils/http-headers'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// GET /api/v1/accounts/verify_credentials — test token + view CredentialAccount.
// https://docs.joinmastodon.org/methods/accounts/#verify_credentials
// Scope: read:accounts (satisfied by the aggregate `read`).
export const GET = traceApiRoute(
  'verifyCredentials',
  getCredentialAccountHandler(CORS_HEADERS)
)
