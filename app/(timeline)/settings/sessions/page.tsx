import { formatDistance, formatRelative } from 'date-fns'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { DeleteSessionButton } from './DeleteSessionButton'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Sessions'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerSession(getAuthOptions())
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

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

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        {sessions.length > 0 ? (
          <ol className="space-y-3">
            {sessions.map((existingSession) => (
              <li
                key={`session-${existingSession.token}`}
                className="rounded-xl border bg-background p-4 shadow-sm"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      Signed in{' '}
                      {formatRelative(existingSession.createdAt, currentTime)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expires in{' '}
                      {formatDistance(existingSession.expireAt, currentTime)}
                    </p>
                  </div>
                  <DeleteSessionButton existingSession={existingSession} />
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No active sessions found.
          </div>
        )}
      </section>
    </div>
  )
}

export default Page
