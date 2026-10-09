import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { AuthCard } from '@/app/(nosidebar)/AuthCard'
import { getAuthLogoSrc } from '@/app/(nosidebar)/getAuthLogoSrc'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

import { ActorSelectionList } from './ActorSelectionList'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Select Actor'
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

  const actors = await database.getActorsForAccount({ accountId: account.id })

  if (actors.length <= 1) {
    return redirect('/')
  }

  return (
    <AuthCard
      logoSrc={getAuthLogoSrc()}
      title="Select an actor"
      description="Choose which identity you want to use for this session"
    >
      <ActorSelectionList
        actors={actors.map((a) => ({
          id: a.id,
          username: a.username,
          domain: a.domain,
          name: a.name,
          iconUrl: isRealAvatar(a.iconUrl) ? a.iconUrl : null
        }))}
      />
    </AuthCard>
  )
}

export default Page
