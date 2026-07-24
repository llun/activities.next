import { cookies } from 'next/headers'
import { cache } from 'react'

import { Database } from '@/lib/database/types'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { isEmailAllowed } from '@/lib/utils/normalizeEmail'

export interface AuthSession {
  user: { email: string }
}

const getActorIdFromCookie = async (): Promise<string | undefined> => {
  try {
    const cookieStore = await cookies()
    return cookieStore.get('activities.actor-id')?.value
  } catch {
    // cookies() may throw if called outside of a request context
    return undefined
  }
}

/**
 * Resolves the account behind a session, enforcing the email allowlist gate.
 * Returns `null` when there is no signed-in email, the email is not allowed, or
 * no matching account exists. Shared by actor and admin resolution.
 */
export const getAccountFromSession = async (
  database: Database,
  session: AuthSession | null
) => {
  if (!session?.user?.email) return null

  const settings = await getResolvedServerSettings(database)
  if (!isEmailAllowed(settings.registrations.allowEmails, session.user.email)) {
    return null
  }

  return database.getAccountFromEmail({ email: session.user.email })
}

// Wrapped in React `cache()` so resolving the viewer is deduplicated within a
// request: the `(timeline)` layout, the public sub-layouts (`[actor]`, `tags`)
// and the page itself all resolve the actor per render. Keyed on (database,
// session); both are stable per request (the singleton database and the cached
// `getServerAuthSession` result), so the account/actor queries run once.
export const getActorFromSession = cache(
  async (database: Database, session: AuthSession | null) => {
    // Fetch account and its actors once — reused across all resolution steps
    const account = await getAccountFromSession(database, session)
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
)
