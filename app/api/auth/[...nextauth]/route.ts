import NextAuth from 'next-auth/next'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'

export const dynamic = 'force-dynamic'

const handler = NextAuth(getAuthOptions())
export { handler as GET, handler as POST }
