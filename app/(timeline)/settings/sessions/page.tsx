import { formatDistance, formatRelative } from 'date-fns'
import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getConfig } from '@/lib/config'
import { getStorage } from '@/lib/storage'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { DeleteSessionButton } from './DeleteSessionButton'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Sessions'
}

const Page = async () => {
  const { host } = getConfig()
  const [storage, session] = await Promise.all([
    getStorage(),
    getServerSession(getAuthOptions())
  ])

  if (!storage) {
    throw new Error('Fail to load storage')
  }

  const actor = await getActorFromSession(storage, session)
  if (!actor || !actor.account) {
    return redirect(`https://${host}/auth/signin`)
  }

  const currentTime = Date.now()
  const sessions = await storage.getAccountAllSessions({
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
