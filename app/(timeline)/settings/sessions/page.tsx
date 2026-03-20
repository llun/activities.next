import { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { SessionsList } from '@/lib/components/settings/SessionsList'
import { getDatabase } from '@/lib/database'
import {
  AUTH_COOKIE_PREFIX,
  AUTH_SESSION_COOKIE_NAME
} from '@/lib/services/auth/auth'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Sessions'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  // Get current session token from cookies (server-side)
  const cookieStore = await cookies()
  const sessionCookieName = `${AUTH_COOKIE_PREFIX}.${AUTH_SESSION_COOKIE_NAME}`
  const secureCookieName = `__Secure-${sessionCookieName}`
  const currentSessionToken =
    cookieStore.get(secureCookieName)?.value ||
    cookieStore.get(sessionCookieName)?.value ||
    null

  const currentTime = Date.now()
  const sessions = await database.getAccountAllSessions({
    accountId: actor.account.id
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Review active sessions and revoke access you no longer need.
        </p>
        <p className="text-sm text-muted-foreground">
          {sessions.length} session{sessions.length === 1 ? '' : 's'} linked to
          your account.
        </p>
      </div>

      <SessionsList
        sessions={sessions}
        currentTime={currentTime}
        currentSessionToken={currentSessionToken}
      />
    </div>
  )
}

export default Page
