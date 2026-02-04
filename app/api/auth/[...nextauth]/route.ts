import NextAuth from 'next-auth/next'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const handler = NextAuth(getAuthOptions())
export const GET = traceApiRoute('nextAuth', handler)
export const POST = traceApiRoute('nextAuth', handler)
