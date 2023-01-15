import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  if (request.nextUrl.href.includes('/activities/_next/')) {
    return NextResponse.rewrite(
      request.nextUrl.href.replace('/activities/_next/', '/_next/')
    )
  }

  console.log(
    `${new Intl.DateTimeFormat('en-US', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date())} ${request.method.toUpperCase()} ${
      request.nextUrl.pathname
    }`
  )
  if (request.method !== 'GET') {
    console.log(await request.text())
  }
}
