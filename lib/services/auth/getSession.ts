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
  // Resolve headers OUTSIDE the try: `headers()` is a dynamic API that, during
  // static generation/prerender, throws an internal control-flow signal (e.g.
  // DynamicServerError) to bail the route out to dynamic rendering. That signal
  // must propagate — catching it would let Next.js statically cache the page as
  // unauthenticated. Only better-auth's session lookup is guarded below.
  const requestHeaders = await headers()
  try {
    // `disableRefresh`: never slide the session from here. When a session is
    // due (`updateAge`), better-auth extends its database `expireAt` AND
    // re-issues the cookie with a fresh Max-Age — but this runs in Server
    // Components and route handlers that drop the `Set-Cookie` it produces.
    // Refreshing here moved the database row forward while the browser cookie
    // kept the 7-day Max-Age from sign-in, so it lapsed 7 days after sign-in
    // however active the user was, and since the row had just been refreshed,
    // nothing else would re-issue the cookie before it did. The refresh happens
    // instead in better-auth's own `/get-session` handler, which
    // `SessionKeepAlive` calls from the signed-in layout, where both writes land.
    return await auth.api.getSession({
      headers: requestHeaders,
      query: { disableRefresh: true }
    })
  } catch (error) {
    // jwt({ disableSettingJwtHeader: true }) suppresses automatic set-auth-jwt
    // signing in the /get-session after-hook. Session resolution can still
    // throw on an adapter, database, or other plugin hook error. Fail closed:
    // log it and treat the request as unauthenticated so public and sign-in
    // pages still render instead of returning a 500.
    // Pass the error under `err` so the logger's GCP formatter extracts its
    // stack trace into `stack_trace` for Error Reporting (see lib/utils/logger).
    logger.error({ message: 'Failed to resolve auth session', err: error })
    return null
  }
})
