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

// Format the app "Authorized" date deterministically in UTC so the
// server-rendered label can't shift by a day with the server's timezone, and
// is identical on every render. Pinned to en-US to match the design
// ("Jun 2, 2026").
const AUTHORIZED_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
})

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
    authorizedLabel: AUTHORIZED_DATE_FORMAT.format(new Date(app.authorizedAt)),
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
