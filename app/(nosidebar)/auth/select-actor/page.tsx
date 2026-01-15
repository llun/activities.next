import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/lib/components/ui/card'
import { getDatabase } from '@/lib/database'

import { ActorSelectionList } from './ActorSelectionList'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Select Actor'
}

const isRealAvatar = (url?: string) => {
  if (!url) return false
  if (url.includes('gravatar')) return false
  if (url.includes('ui-avatars')) return false
  if (url.includes('robohash')) return false
  if (url.includes('dicebear')) return false
  if (url.includes('boringavatars')) return false
  if (url.includes('default')) return false
  if (url.includes('placeholder')) return false
  return true
}

const Page: FC = async () => {
  const database = getDatabase()
  const session = await getServerSession(getAuthOptions())

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
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Select an actor</CardTitle>
        <CardDescription>
          Choose which identity you want to use for this session
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActorSelectionList
          actors={actors.map((a) => ({
            id: a.id,
            username: a.username,
            domain: a.domain,
            name: a.name,
            iconUrl: isRealAvatar(a.iconUrl) ? a.iconUrl : null
          }))}
        />
      </CardContent>
    </Card>
  )
}

export default Page
