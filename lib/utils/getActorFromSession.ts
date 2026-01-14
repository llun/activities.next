import { Session } from 'next-auth'
import { cookies } from 'next/headers'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'

const getSessionToken = async (): Promise<string | undefined> => {
  try {
    const cookieStore = await cookies()
    return (
      cookieStore.get('__Secure-next-auth.session-token')?.value ||
      cookieStore.get('next-auth.session-token')?.value
    )
  } catch {
    // cookies() may throw if called outside of a request context
    return undefined
  }
}

export const getActorFromSession = async (
  database: Database,
  session: Session | null
) => {
  const config = getConfig()
  if (!session?.user?.email) return null
  if (
    config.allowEmails.length &&
    !config.allowEmails.includes(session.user.email)
  ) {
    return null
  }

  // 1. Check session-specific actor
  const sessionToken = await getSessionToken()
  if (sessionToken) {
    const sessionData = await database.getAccountSession({
      token: sessionToken
    })
    if (sessionData?.session?.actorId) {
      return database.getActorFromId({ id: sessionData.session.actorId })
    }
  }

  // 2. Check default actor
  const account = await database.getAccountFromEmail({
    email: session.user.email
  })
  if (account?.defaultActorId) {
    return database.getActorFromId({ id: account.defaultActorId })
  }

  // 3. Fall back to first actor
  return database.getActorFromEmail({ email: session.user.email })
}
