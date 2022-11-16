import type { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  console.log(
    `${new Intl.DateTimeFormat('en-US', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date())} ${request.method.toUpperCase()} ${
      request.nextUrl.pathname
    }`
  )
  if (request.method === 'POST') {
    console.log(await request.text())
  }
}
