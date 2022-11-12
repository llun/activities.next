import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  console.log(
    `${new Date()} ${request.method.toUpperCase()} ${request.nextUrl.pathname}`
  )
}
