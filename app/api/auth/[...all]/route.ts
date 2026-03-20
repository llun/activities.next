import { toNextJsHandler } from 'better-auth/next-js'

import { getAuth } from '@/lib/services/auth/auth'

export const dynamic = 'force-dynamic'

export const GET = (request: Request) => toNextJsHandler(getAuth()).GET(request)
export const POST = (request: Request) =>
  toNextJsHandler(getAuth()).POST(request)
