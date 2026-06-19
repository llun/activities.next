import { toNextJsHandler } from 'better-auth/next-js'

import { getConfig } from '@/lib/config'
import { getAuth } from '@/lib/services/auth/auth'
import { resolveAuthBaseURL } from '@/lib/services/auth/requestOrigin'

export const dynamic = 'force-dynamic'

// Resolve the auth instance for the domain the request arrived on so passkey
// ceremonies (register/authenticate) use the matching WebAuthn rpID/origin,
// enabling per-domain passkeys across ACTIVITIES_HOST + ACTIVITIES_TRUSTED_HOSTS.
const authForRequest = (request: Request) => {
  const config = getConfig()
  return getAuth(resolveAuthBaseURL(request.headers, config))
}

export const GET = (request: Request) =>
  toNextJsHandler(authForRequest(request)).GET(request)
export const POST = (request: Request) =>
  toNextJsHandler(authForRequest(request)).POST(request)
