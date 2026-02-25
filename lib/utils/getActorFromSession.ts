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

  // Fetch account and its actors once — reused across all resolution steps below
  const account = await database.getAccountFromEmail({
    email: session.user.email
  })
  if (!account) return null

  const actors = await database.getActorsForAccount({ accountId: account.id })

  // 1. Check actor selection cookie
  const actorIdFromCookie = await getActorIdFromCookie()
  if (actorIdFromCookie) {
    const cookieActor = actors.find(
      (a) => a.id === actorIdFromCookie && !a.deletionStatus
    )
    if (cookieActor) return cookieActor
  }

  // 2. Check default actor
  if (account.defaultActorId) {
    const defaultActor = actors.find(
      (a) => a.id === account.defaultActorId && !a.deletionStatus
    )
    if (defaultActor) return defaultActor
  }

  // 3. Fall back to first actor without pending deletion
  return actors.find((a) => !a.deletionStatus) ?? null
}
