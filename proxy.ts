import { NextRequest, NextResponse } from 'next/server'

import { getProxyHostConfig } from '@/lib/config/host'
import { acceptContainsContentTypes } from '@/lib/utils/acceptContainsContentTypes'
import { selectHeaderHost } from '@/lib/utils/host'

export const config = {
  matcher: ['/(@.*)']
}

const proxyHeaderHost = (headers: Headers): string => {
  return selectHeaderHost(headers, getProxyHostConfig())
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
        return NextResponse.rewrite(apiUrl)
      }

      // Actor status route
      if (/^\/@\w+\/[\w-]+$/.test(pathname) && acceptValue) {
        const matches = pathname.match(
          /^\/@(?<username>\w+)\/(?<statusId>[\w-]+)/
        )
        const apiUrl = request.nextUrl.clone()
        apiUrl.pathname = `/api/users/${matches?.groups?.username}/statuses/${matches?.groups?.statusId}`
        return NextResponse.rewrite(apiUrl)
      }
    }

    // Redirect actor with no host
    if (request.nextUrl.pathname.startsWith('/@')) {
      const pathname = request.nextUrl.pathname
      const totalAt = pathname
        .split('')
        .reduce((count, char) => (char === '@' ? count + 1 : count), 0)
      if (totalAt === 2) return NextResponse.next()

      const host = proxyHeaderHost(request.headers) || request.nextUrl.host
      const pathItems = pathname.split('/').slice(1)
      pathItems[0] = `${pathItems[0]}@${host}`

      const cloneUrl = request.nextUrl.clone()
      cloneUrl.pathname = `/${pathItems.join('/')}`
      return NextResponse.rewrite(cloneUrl)
    }

    return NextResponse.next()
  }
}
