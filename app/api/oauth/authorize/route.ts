import { NextRequest } from 'next/server'

import { getBaseURL } from '@/lib/config'
import {
  oauthLogger,
  sanitizeHeaders,
  sanitizeParams
} from '@/lib/services/oauth/logging'

// Log the authorize params we forward to better-auth. The authorize endpoint
// itself returns a redirect (302); a downstream 400 is raised by better-auth's
// /api/auth/oauth2/authorize. This route only redirects and never observes that
// failure, so the log is emitted at `info` (not `debug`) — otherwise it would be
// suppressed at the default production level and there would be nothing to
// correlate the downstream 400 to the client request that triggered it.
const logAuthorizeRequest = (
  req: NextRequest,
  url: URL,
  method: 'GET' | 'POST'
) => {
  oauthLogger.info(
    {
      endpoint: 'authorize',
      method,
      headers: sanitizeHeaders(req.headers),
      params: sanitizeParams(Object.fromEntries(url.searchParams))
    },
    'OAuth authorize request received'
  )
}

// Redirect to better-auth's OAuth2 authorize endpoint for Mastodon compatibility
// Mastodon clients may hit /api/oauth/authorize directly
export const GET = (req: NextRequest) => {
  const url = new URL('/api/auth/oauth2/authorize', getBaseURL())
  url.search = req.nextUrl.search
  logAuthorizeRequest(req, url, 'GET')
  return Response.redirect(url.toString(), 302)
}

export const POST = async (req: NextRequest) => {
  const url = new URL('/api/auth/oauth2/authorize', getBaseURL())
  // Merge query string params
  req.nextUrl.searchParams.forEach((value, key) =>
    url.searchParams.set(key, value)
  )
  // Merge form body params (application/x-www-form-urlencoded)
  try {
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = await req.text()
      new URLSearchParams(body).forEach((value, key) =>
        url.searchParams.set(key, value)
      )
    }
  } catch (e) {
    oauthLogger.error(
      { endpoint: 'authorize', method: 'POST', err: e },
      'Failed to parse authorize POST body'
    )
  }
  logAuthorizeRequest(req, url, 'POST')
  return Response.redirect(url.toString(), 302)
}
