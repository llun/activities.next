import { getAuth } from '@/lib/services/auth/auth'

export const dynamic = 'force-dynamic'

const handler = (req: Request) => {
  const auth = getAuth()
  return auth.handler(req)
}

export const GET = handler
export const POST = handler
