import { NextRequest, NextResponse } from 'next/server'

import { acceptContainsContentTypes } from './lib/accept'

export const config = {
  matcher: ['/(@.*)']
}

export async function middleware(request: NextRequest) {
  // Redirect actor with no host
  if (request.nextUrl.pathname.startsWith('/@')) {
    const pathname = request.nextUrl.pathname
    const totalAt = pathname
      .split('')
      .reduce((count, char) => (char === '@' ? count + 1 : count), 0)
    if (totalAt === 2) return NextResponse.next()

    const host = request.headers.get('host') ?? request.nextUrl.host
    const pathItems = pathname.split('/').slice(1)
    pathItems[0] = `${pathItems[0]}@${host}`

    const cloneUrl = request.nextUrl.clone()
    cloneUrl.pathname = `/${pathItems.join('/')}`
    return NextResponse.rewrite(cloneUrl)
  }

  if (request.method === 'GET') {
    const pathname = request.nextUrl.pathname
    const acceptValue = request.headers.get('Accept')

    // Actor route
    if (/^\/@[\w\d]+$/.test(pathname) && acceptValue) {
      if (
        acceptContainsContentTypes(acceptValue, [
          'application/activity+json',
          'application/ld+json',
          'application/json'
        ])
      ) {
        const matches = pathname.match(/^\/@(?<username>[\w\d]+)/)
        const apiUrl = request.nextUrl.clone()
        apiUrl.pathname = `/api/users/${matches?.groups?.username}`
        return NextResponse.rewrite(apiUrl)
      }
      return NextResponse.next()
    }

    // Actor status route
    if (/^\/@[\w\d]+\/[\w\d-]+$/.test(pathname) && acceptValue) {
      if (
        acceptContainsContentTypes(acceptValue, [
          'application/activity+json',
          'application/ld+json',
          'application/json'
        ])
      ) {
        const matches = pathname.match(
          /^\/@(?<username>[\w\d]+)\/(?<statusId>[\w\d-]+)/
        )
        const apiUrl = request.nextUrl.clone()
        apiUrl.pathname = `/api/users/${matches?.groups?.username}/statuses/${matches?.groups?.statusId}`
        return NextResponse.rewrite(apiUrl)
      }
      return NextResponse.next()
    }

    return NextResponse.next()
  }
}
