import { format } from 'date-fns'
import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import {
  AccountAppRow,
  AccountSessionRow,
  AccountSessions,
  SessionActor
} from '@/app/(timeline)/account/sessions/AccountSessions'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Account Sessions'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const authSession = await getServerAuthSession()
  const actor = await getActorFromSession(database, authSession)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const accountId = actor.account.id
  // The better-auth session token is the value stored in `sessions.token`, so it
  // pins "this device" exactly without parsing the signed cookie.
  const currentToken = authSession?.session?.token ?? null
  const currentTime = Date.now()

  const [sessions, actors, connectedApps] = await Promise.all([
    database.getAccountAllSessions({ accountId }),
    database.getActorsForAccount({ accountId }),
    database.getAccountConnectedApps({ accountId })
  ])

  const actorMap = new Map<string, SessionActor>(
    actors.map((accountActor) => [
      accountActor.id,
      {
        id: accountActor.id,
        name: accountActor.name || accountActor.username,
        handle: `@${accountActor.username}@${accountActor.domain}`,
        iconUrl: isRealAvatar(accountActor.iconUrl)
          ? (accountActor.iconUrl ?? null)
          : null
      }
    ])
  )

  const sessionRows: AccountSessionRow[] = sessions
    // Drop already-expired sessions: they can't be used, so listing them as
    // revocable is noise. The current session is never expired.
    .filter((session) => session.expireAt > currentTime)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((session) => ({
      token: session.token,
      actor: session.actorId ? (actorMap.get(session.actorId) ?? null) : null,
      createdAt: session.createdAt,
      expireAt: session.expireAt,
      current: currentToken !== null && session.token === currentToken
    }))

  const appRows: AccountAppRow[] = connectedApps.map((app) => ({
    clientId: app.clientId,
    actorId: app.actorId,
    actor: app.actorId ? (actorMap.get(app.actorId) ?? null) : null,
    name: app.name,
    website: app.website,
    scopes: app.scopes,
    authorizedLabel: format(new Date(app.authorizedAt), 'PP'),
    signIn: app.signIn
  }))

  return (
    <AccountSessions
      currentTime={currentTime}
      sessions={sessionRows}
      apps={appRows}
    />
  )
}

export default Page
