import { formatDistance, formatRelative } from 'date-fns'
import { Metadata } from 'next'
import { auth } from '@/auth'
import { redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { DeleteSessionButton } from './DeleteSessionButton'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Sessions'
}

const Page = async () => {
  const { host } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await auth()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect(`https://${host}/auth/signin`)
  }

  const currentTime = Date.now()
  const sessions = await database.getAccountAllSessions({
    accountId: actor.account.id
  })

  return (
    <div>
      <h2>Sessions</h2>
      <ol>
        {sessions.map((existingSession) => (
          <li key={`session-${existingSession.expireAt}`}>
            Session created at{' '}
            {formatRelative(existingSession.createdAt, currentTime)} and will
            expires in {formatDistance(existingSession.expireAt, currentTime)}
            <DeleteSessionButton existingSession={existingSession} />
          </li>
        ))}
      </ol>
    </div>
  )
}

export default Page
