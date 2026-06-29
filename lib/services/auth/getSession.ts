import { headers } from 'next/headers'
import { cache } from 'react'

import { logger } from '@/lib/utils/logger'

import { getAuth } from './auth'

// Wrapped in React `cache()` so the better-auth session lookup is deduplicated
// within a single request. Layouts, nested sub-layouts and the page itself all
// resolve the viewer per render; without this each call would re-read the
// session independently.
export const getServerAuthSession = cache(async () => {
  const auth = getAuth()
  try {
    return await auth.api.getSession({
      headers: await headers()
    })
  } catch (error) {
    // better-auth resolves the session and THEN, via the jwt plugin's
    // `/get-session` after-hook, signs a short-lived JWT for the `set-auth-jwt`
    // response header (which this app does not consume). If that signing throws
    // — e.g. a `jwks` key whose alg doesn't match the configured RS256 (a
    // pre-#1040 Ed25519 key left behind on the rollout) raises
    // `ERR_JOSE_NOT_SUPPORTED` — the whole getSession call rejects. Left
    // unhandled that 500s every authenticated page, notably the
    // `/oauth/authorize` consent page, breaking Mastodon/OAuth login while OIDC
    // relying parties (which hit better-auth's authorize endpoint, not
    // `/get-session`) keep working — an asymmetry that's hard to diagnose.
    //
    // Fail closed: log it (this is a deploy-config issue — clear stale `jwks`
    // rows on the RS256 rollout) and treat the request as unauthenticated so
    // public and sign-in paths still render instead of the whole app erroring.
    logger.error({ message: 'Failed to resolve auth session', error })
    return null
  }
})
