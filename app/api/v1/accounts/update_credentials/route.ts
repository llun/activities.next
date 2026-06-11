import {
  UPDATE_CREDENTIALS_CORS_HEADERS,
  updateCredentialsHandler
} from '@/lib/services/accounts/updateCredentialsHandler'
import { defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const OPTIONS = defaultOptions(UPDATE_CREDENTIALS_CORS_HEADERS)

// PATCH /api/v1/accounts/update_credentials — update the current actor's
// profile and return the updated CredentialAccount.
// https://docs.joinmastodon.org/methods/accounts/#update_credentials
// Scope: write:accounts (satisfied by the aggregate `write`).
export const PATCH = traceApiRoute(
  'updateCredentials',
  updateCredentialsHandler(UPDATE_CREDENTIALS_CORS_HEADERS)
)
