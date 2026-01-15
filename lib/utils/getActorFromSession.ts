import { Session } from 'next-auth'
import { cookies } from 'next/headers'

import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'

const getActorIdFromCookie = async (): Promise<string | undefined> => {
  try {
    const cookieStore = await cookies()
    return cookieStore.get('activities.actor-id')?.value
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

  // 1. Check actor selection cookie
  const actorIdFromCookie = await getActorIdFromCookie()
  if (actorIdFromCookie) {
    // Verify the actor belongs to the account
    const account = await database.getAccountFromEmail({
      email: session.user.email
    })
    if (account) {
      const actors = await database.getActorsForAccount({
        accountId: account.id
      })
      const validActor = actors.find((a) => a.id === actorIdFromCookie)
      if (validActor) {
        return database.getActorFromId({ id: actorIdFromCookie })
      }
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
