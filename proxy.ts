import { NextRequest, NextResponse } from 'next/server'

import { getProxyHostConfig } from '@/lib/config/host'
import { acceptContainsContentTypes } from '@/lib/utils/acceptContainsContentTypes'
import { selectHeaderHost } from '@/lib/utils/host'
// Direct sub-path import required: the barrel re-exports cors.ts which pulls
// @/lib/config (fs/path deps) into the middleware Edge Runtime bundle.
import {
  getContentSecurityPolicyHeader,
  getEmbedContentSecurityPolicyHeader
} from '@/lib/utils/http-headers/csp'

export const config = {
  matcher: [
    '/((?!(?:_next/static|_next/image)(?:/|$)|favicon\\.ico$|activities/_next(?:/|$)).*)'
  ]
}

const proxyHeaderHost = (headers: Headers): string => {
  return selectHeaderHost(headers, getProxyHostConfig())
}

const withContentSecurityPolicy = (
  response: NextResponse,
  request: NextRequest
) => {
  // The public embed widgets are framable by third-party sites, so they get a
  // CSP with `frame-ancestors *` instead of the default `'none'`.
  const header = request.nextUrl.pathname.startsWith('/embed/')
    ? getEmbedContentSecurityPolicyHeader()
    : getContentSecurityPolicyHeader()
  if (!response.headers.has(header.key)) {
    response.headers.set(header.key, header.value)
  }

  return response
}

const VALID_AUTH_PAGES = new Set([
  '/auth/signin',
  '/auth/signup',
  '/auth/error',
  '/auth/confirmation',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/select-actor',
  '/auth/two-factor'
])

const isRewrittenApiRoute = (pathname: string): boolean => {
  return pathname === '/inbox' || pathname.startsWith('/users/')
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Reject non-existent auth subpaths (e.g. /auth/callback) early with 404
  // so they do not fall through to the dynamic `/[actor]/[status]` route.
  if (
    (pathname === '/auth' || pathname.startsWith('/auth/')) &&
    !VALID_AUTH_PAGES.has(pathname)
  ) {
    return withContentSecurityPolicy(
      new NextResponse(null, { status: 404 }),
      request
    )
  }

  // Actor routes (/@username, /@username/statusId, etc.) only accept GET and HEAD.
  // Reject mutating methods with 405 Method Not Allowed rather than letting Next.js
  // treat POST as an unregistered Server Action (which throws 500).
  if (pathname.startsWith('/@')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return withContentSecurityPolicy(
        new NextResponse(null, {
          status: 405,
          headers: { Allow: 'GET, HEAD' }
        }),
        request
      )
    }
  }

  // Next.js App Router treats ANY POST request to a page route as a Server Action invocation.
  // If the page does not define Server Actions and no action ID is provided, Next.js throws
  // "Failed to find Server Action" and produces a 500 error.
  // In activities.next, POST requests are only valid on API route handlers (/api/*), OAuth
  // route handlers (/oauth/*), admin Server Actions (/admin/* or with Next-Action header),
  // and rewritten API routes (/inbox, /users/*).
  // All other page POSTs are rejected cleanly here.
  if (
    request.method === 'POST' &&
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/oauth/') &&
    !pathname.startsWith('/admin') &&
    !isRewrittenApiRoute(pathname) &&
    !request.headers.has('next-action')
  ) {
    return withContentSecurityPolicy(
      new NextResponse(null, { status: 404 }),
      request
    )
  }

  // Reject mutating methods (PUT, DELETE, PATCH) targeted at non-API routes.
  if (
    (request.method === 'PUT' ||
      request.method === 'DELETE' ||
      request.method === 'PATCH') &&
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/oauth/') &&
    !isRewrittenApiRoute(pathname)
  ) {
    return withContentSecurityPolicy(
      new NextResponse(null, {
        status: 405,
        headers: { Allow: 'GET, HEAD' }
      }),
      request
    )
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    const acceptValue = request.headers.get('Accept')

    if (
      acceptValue &&
      acceptContainsContentTypes(acceptValue, [
        'application/activity+json',
        'application/ld+json',
        'application/json'
      ])
    ) {
      // Actor route
      if (/^\/@\w+$/.test(pathname)) {
        const matches = pathname.match(/^\/@(?<username>\w+)/)
        const apiUrl = request.nextUrl.clone()
        apiUrl.pathname = `/api/users/${matches?.groups?.username}`
        return withContentSecurityPolicy(NextResponse.rewrite(apiUrl), request)
      }

      // Actor status route
      if (/^\/@\w+\/[\w-]+$/.test(pathname)) {
        const matches = pathname.match(
          /^\/@(?<username>\w+)\/(?<statusId>[\w-]+)/
        )
        const apiUrl = request.nextUrl.clone()
        apiUrl.pathname = `/api/users/${matches?.groups?.username}/statuses/${matches?.groups?.statusId}`
        return withContentSecurityPolicy(NextResponse.rewrite(apiUrl), request)
      }
    }

    // Redirect actor with no host
    if (request.nextUrl.pathname.startsWith('/@')) {
      const pathname = request.nextUrl.pathname
      const totalAt = pathname.split('@').length - 1
      if (totalAt === 2) {
        return withContentSecurityPolicy(NextResponse.next(), request)
      }

      const host = proxyHeaderHost(request.headers) || request.nextUrl.host
      const pathItems = pathname.split('/').slice(1)
      pathItems[0] = `${pathItems[0]}@${host}`

      const cloneUrl = request.nextUrl.clone()
      cloneUrl.pathname = `/${pathItems.join('/')}`
      return withContentSecurityPolicy(NextResponse.rewrite(cloneUrl), request)
    }

    return withContentSecurityPolicy(NextResponse.next(), request)
  }

  return withContentSecurityPolicy(NextResponse.next(), request)
}
