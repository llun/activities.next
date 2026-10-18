import { toNextJsHandler } from 'better-auth/next-js'

import { getAuth } from '@/lib/services/auth/auth'
import { resolveAuthBaseURL } from '@/lib/services/auth/requestOrigin'
import {
  ensureServedDomainsFresh,
  getServedHostConfig
} from '@/lib/services/domains/servedDomainSnapshot'

export const dynamic = 'force-dynamic'

// Resolve the auth instance for the domain the request arrived on so passkey
// ceremonies (register/authenticate) use the matching WebAuthn rpID/origin,
// enabling per-domain passkeys across ACTIVITIES_HOST, ACTIVITIES_TRUSTED_HOSTS
// and the active Admin › Domains rows. The snapshot of those rows is brought up
// to date first, so a domain turned off on another instance stops getting its
// own auth instance (and trusted origin) here too.
const authForRequest = async (request: Request) => {
  await ensureServedDomainsFresh()
  return getAuth(resolveAuthBaseURL(request.headers, getServedHostConfig()))
}

export const GET = async (request: Request) =>
  toNextJsHandler(await authForRequest(request)).GET(request)
export const POST = async (request: Request) =>
  toNextJsHandler(await authForRequest(request)).POST(request)
