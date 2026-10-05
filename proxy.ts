import { NextRequest, NextResponse } from 'next/server'

import { getProxyHostConfig } from '@/lib/config/host'
import { acceptContainsContentTypes } from '@/lib/utils/acceptContainsContentTypes'
import { selectHeaderHost } from '@/lib/utils/host'
// Direct sub-path import required: the barrel re-exports cors.ts which pulls
// @/lib/config (fs/path deps) into the middleware Edge Runtime bundle.
import {
  getContentSecurityPolicyHeader,
  getEmbedContentSecurityPolicyHeader,
  getMediaFileContentSecurityPolicyHeader
} from '@/lib/utils/http-headers/csp'

// Next buffers the body of every non-GET/HEAD request the proxy runs on, so the
// proxy and the route handler can both read it, and caps that buffer at
// `experimental.proxyClientMaxBodySize` (10 MB by default). Past the cap the
// handler silently receives a truncated body, which breaks every multipart
// upload larger than that. The proxy does nothing for an /api/* request except
// add the CSP header, so multipart /api/* requests skip it instead of raising
// the cap for everyone. Bare /api is always matched so its POST/PUT/PATCH/DELETE
// keep the proxy's 404/405 instead of falling through to the [actor] page; the
// GET-only /api/v1/files/* downloads are always matched so a multipart
// Content-Type cannot strip their CSP.
// The header value is matched case-sensitively as an anchored regex, hence the
// spelled-out character classes.
export const config = {
  matcher: [
    '/((?!(?:_next/static|_next/image)(?:/|$)|api/.|favicon\\.ico$|activities/_next(?:/|$)).*)',
    {
      source: '/api/:path+',
      missing: [
        {
          type: 'header',
          key: 'content-type',
          value:
            '\\s*[Mm][Uu][Ll][Tt][Ii][Pp][Aa][Rr][Tt]/[Ff][Oo][Rr][Mm]-[Dd][Aa][Tt][Aa].*'
        }
      ]
    },
    { source: '/api/v1/files/:path*' }
  ]
}

const MEDIA_FILE_ROUTE_PREFIX = '/api/v1/files/'

// Compared on a decoded, slash-collapsed form so an escaped or doubled
// separator cannot reach the files route while dodging its policy. Erring
// toward the sandboxed policy costs nothing on any other path.
const isMediaFileRoutePath = (pathname: string): boolean => {
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // Keep the raw form; it is still compared below.
  }
  return [pathname, decoded].some((value) =>
    value.replace(/\/{2,}/g, '/').startsWith(MEDIA_FILE_ROUTE_PREFIX)
  )
}

const proxyHeaderHost = (headers: Headers): string => {
  return selectHeaderHost(headers, getProxyHostConfig())
}

const withContentSecurityPolicy = (
  response: NextResponse,
  request: NextRequest
) => {
  // The public embed widgets are framable by third-party sites, so they get a
  // CSP with `frame-ancestors *` instead of the default `'none'`. Stored upload
  // bytes get the sandboxed media policy instead of the app's: the header set
  // here wins over the route's own (Next only appends a route header the
  // middleware response did not already carry), so the files route cannot
  // tighten it by itself.
  const { pathname } = request.nextUrl
  const header = isMediaFileRoutePath(pathname)
    ? getMediaFileContentSecurityPolicyHeader()
    : pathname.startsWith('/embed/')
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

  // Next.js App Router inspects incoming requests to determine if they are Server
  // Action invocations based on request method (POST), headers (e.g. Next-Action /
  // ACTION_HEADER), and content type (multipart/form-data or urlencoded). If a request
  // resembles an action or targets an action route but cannot be resolved, Next.js can
  // reject or fail the request.
  // In activities.next, POST requests are only valid on API route handlers (/api/*), OAuth
  // route handlers (/oauth/*), admin Server Actions (/admin, /admin/*, or with Next-Action header),
  // and rewritten API routes (/inbox, /users/*).
  // All other page POSTs are rejected cleanly here.
  if (
    request.method === 'POST' &&
    !pathname.startsWith('/api/') &&
    !pathname.startsWith('/oauth/') &&
    pathname !== '/admin' &&
    !pathname.startsWith('/admin/') &&
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
