import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { SessionsList } from '@/lib/components/settings/SessionsList'
import { getDatabase } from '@/lib/database'
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

      <SessionsList sessions={sessions} currentTime={currentTime} />
    </div>
  )
}

export default Page
