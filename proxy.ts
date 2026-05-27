import { NextRequest, NextResponse } from 'next/server'

import { getProxyHostConfig } from '@/lib/config/host'
import { acceptContainsContentTypes } from '@/lib/utils/acceptContainsContentTypes'
import { selectHeaderHost } from '@/lib/utils/host'
// Direct sub-path import required: the barrel re-exports cors.ts which pulls
// @/lib/config (fs/path deps) into the middleware Edge Runtime bundle.
import { getContentSecurityPolicyHeader } from '@/lib/utils/http-headers/csp'

export const config = {
  matcher: [
    '/((?!(?:_next/static|_next/image)(?:/|$)|favicon\\.ico$|activities/_next(?:/|$)).*)'
  ]
}

const proxyHeaderHost = (headers: Headers): string => {
  return selectHeaderHost(headers, getProxyHostConfig())
}

const withContentSecurityPolicy = (response: NextResponse) => {
  const header = getContentSecurityPolicyHeader()
  if (!response.headers.has(header.key)) {
    response.headers.set(header.key, header.value)
  }

  return response
}

export async function proxy(request: NextRequest) {
  if (request.method === 'GET') {
    const pathname = request.nextUrl.pathname
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
        return withContentSecurityPolicy(NextResponse.rewrite(apiUrl))
      }

      // Actor status route
      if (/^\/@\w+\/[\w-]+$/.test(pathname) && acceptValue) {
        const matches = pathname.match(
          /^\/@(?<username>\w+)\/(?<statusId>[\w-]+)/
        )
        const apiUrl = request.nextUrl.clone()
        apiUrl.pathname = `/api/users/${matches?.groups?.username}/statuses/${matches?.groups?.statusId}`
        return withContentSecurityPolicy(NextResponse.rewrite(apiUrl))
      }
    }

    // Redirect actor with no host
    if (request.nextUrl.pathname.startsWith('/@')) {
      const pathname = request.nextUrl.pathname
      const totalAt = pathname
        .split('')
        .reduce((count, char) => (char === '@' ? count + 1 : count), 0)
      if (totalAt === 2) {
        return withContentSecurityPolicy(NextResponse.next())
      }

      const host = proxyHeaderHost(request.headers) || request.nextUrl.host
      const pathItems = pathname.split('/').slice(1)
      pathItems[0] = `${pathItems[0]}@${host}`

      const cloneUrl = request.nextUrl.clone()
      cloneUrl.pathname = `/${pathItems.join('/')}`
      return withContentSecurityPolicy(NextResponse.rewrite(cloneUrl))
    }

    return withContentSecurityPolicy(NextResponse.next())
  }

  return withContentSecurityPolicy(NextResponse.next())
}
