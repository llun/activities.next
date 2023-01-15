import { NextRequest, NextResponse } from 'next/server'

export async function middleware(request: NextRequest) {
  if (request.nextUrl.href.includes('/activities/_next/')) {
    return NextResponse.rewrite(
      request.nextUrl.href.replace('/activities/_next/', '/_next/')
    )
  }

  const text = request.method !== 'GET' ? await request.text() : null
  console.log({
    time: Date.now(),
    method: request.method.toUpperCase(),
    pathname: request.nextUrl.pathname,
    host: request.nextUrl.host,
    ...(text ? { content: text } : null)
  })
  console.log(request.headers)
  if (request.method !== 'GET') console.log(text)
}
