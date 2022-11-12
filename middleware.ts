import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  console.log(
    `${new Intl.DateTimeFormat('en-US', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date())} ${request.method.toUpperCase()} ${
      request.nextUrl.pathname
    }`
  )
}
