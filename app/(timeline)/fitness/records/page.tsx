import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { PersonalRecordsView } from './PersonalRecordsView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Fitness Records'
}

const Page: FC = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Records"
        description="Your best power and fastest runs, from every activity you’ve recorded. Only you can see them."
      />
      <PersonalRecordsView />
    </div>
  )
}

export default Page
