import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { AuthCard, AuthCardBody } from '@/app/(nosidebar)/AuthCard'
import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'
import { isUsableAccountActor } from '@/lib/utils/selectAccountActor'

import { ActorSelectionList } from './ActorSelectionList'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Select Actor'
}

const Page: FC = async () => {
  const database = getDatabase()
  const session = await getServerAuthSession()

  if (!database) throw new Error('Database is not available')
  if (!session?.user?.email) {
    return redirect('/auth/signin')
  }

  const account = await database.getAccountFromEmail({
    email: session.user.email
  })
  if (!account) {
    return redirect('/auth/signin')
  }

  // Only usable actors are offered: a suspended or deleting actor cannot act,
  // and `actors/switch` refuses it, so listing it would present a choice that
  // fails with a server error.
  const actors = (
    await database.getActorsForAccount({ accountId: account.id })
  ).filter(isUsableAccountActor)

  if (actors.length <= 1) {
    return redirect('/')
  }

  return (
    <AuthCard
      logoSrc={getAuthLogoSrc()}
      title="Select an actor"
      description="Choose which identity you want to use for this session"
    >
      <AuthCardBody>
        <ActorSelectionList
          actors={actors.map((a) => ({
            id: a.id,
            username: a.username,
            domain: a.domain,
            name: a.name,
            iconUrl: isRealAvatar(a.iconUrl) ? a.iconUrl : null
          }))}
        />
      </AuthCardBody>
    </AuthCard>
  )
}

export default Page
