import { toNextJsHandler } from 'better-auth/next-js'

import { getDatabase } from '@/lib/database'
import { getAuth } from '@/lib/services/auth/auth'
import { resolveAuthServiceName } from '@/lib/services/auth/authServiceName'
import { resolveAuthBaseURL } from '@/lib/services/auth/requestOrigin'
import {
  ensureServedDomainsFresh,
  getServedHostConfig
} from '@/lib/services/domains/servedDomainSnapshot'

export const dynamic = 'force-dynamic'

// Resolve the auth instance for the domain the request arrived on so passkey
// ceremonies (register/authenticate) use the matching WebAuthn rpID/origin,
// enabling per-domain passkeys across ACTIVITIES_HOST, ACTIVITIES_TRUSTED_HOSTS
// and the active Admin › Served domains rows. The snapshot of those rows is brought up
// to date first, so a domain turned off on another instance stops getting its
// own auth instance (and trusted origin) here too. The instance also carries
// that domain's name, as the passkey rpName and the 2FA issuer.
const authForRequest = async (request: Request) => {
  await ensureServedDomainsFresh()
  const baseURL = resolveAuthBaseURL(request.headers, getServedHostConfig())
  return getAuth(baseURL, await resolveAuthServiceName(getDatabase(), baseURL))
}

export const GET = async (request: Request) =>
  toNextJsHandler(await authForRequest(request)).GET(request)
export const POST = async (request: Request) =>
  toNextJsHandler(await authForRequest(request)).POST(request)
