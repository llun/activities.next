import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'

// Redirect to better-auth's OAuth2 authorize endpoint for Mastodon compatibility
// Mastodon clients may hit /api/oauth/authorize directly
export const GET = (req: NextRequest) => {
  const config = getConfig()
  const baseURL = config.host.startsWith('http')
    ? config.host
    : `${process.env.ACTIVITIES_INSECURE_AUTH === 'true' ? 'http' : 'https'}://${config.host}`
  const url = new URL('/api/auth/oauth2/authorize', baseURL)
  url.search = req.nextUrl.search
  return Response.redirect(url.toString(), 302)
}

export const POST = GET
