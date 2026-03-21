import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { logger } from '@/lib/utils/logger'

// Redirect to better-auth's OAuth2 authorize endpoint for Mastodon compatibility
// Mastodon clients may hit /api/oauth/authorize directly
const getBaseURL = () => {
  const config = getConfig()
  return config.host.includes('://')
    ? config.host
    : `${process.env.ACTIVITIES_INSECURE_AUTH === 'true' ? 'http' : 'https'}://${config.host}`
}

export const GET = (req: NextRequest) => {
  const url = new URL('/api/auth/oauth2/authorize', getBaseURL())
  url.search = req.nextUrl.search
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
    logger.error({ message: 'Failed to parse authorize POST body', error: e })
  }
  return Response.redirect(url.toString(), 302)
}
