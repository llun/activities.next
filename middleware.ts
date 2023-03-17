import { NextRequest, NextResponse } from 'next/server'

import { acceptContainsContentTypes } from './lib/accept'

export async function middleware(request: NextRequest) {
  if (request.method === 'POST') {
    const data = await request.json()
    console.log(JSON.stringify(data, null, 2))
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
  }
}
