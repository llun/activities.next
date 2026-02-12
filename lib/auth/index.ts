import { betterAuth } from 'better-auth'
import { headers as getHeaders } from 'next/headers'

import { getConfig } from '@/lib/config'

import { databaseAdapter } from './adapter'

export const auth = betterAuth({
  database: databaseAdapter() as any,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true
  },
  socialProviders: {
    github: {
      clientId: getConfig().auth?.github?.id || '',
      clientSecret: getConfig().auth?.github?.secret || '',
      enabled: Boolean(
        getConfig().auth?.github?.id && getConfig().auth?.github?.secret
      )
    }
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60 // 5 minutes
    }
  },
  secret: getConfig().secretPhase,
  trustedOrigins: [process.env.NEXTAUTH_URL || 'http://localhost:3000']
})

// Helper to get session compatible with existing code
export async function getSession() {
  try {
    const headers = await getHeaders()
    const session = await auth.api.getSession({
      headers: headers as any
    })

    if (!session?.session || !session?.user) {
      return null
    }

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        emailVerified: session.user.emailVerified
          ? new Date(session.user.emailVerified)
          : null
      },
      expires: new Date(session.session.expiresAt)
    }
  } catch {
    return null
  }
}

export type Session = Awaited<ReturnType<typeof getSession>>
