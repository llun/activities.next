import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { GearListView } from './GearListView'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Fitness Gear'
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
        title="Gear"
        description="Bikes, shoes and recording devices, with lifetime distance from every activity they're used on. Distance is computed from the activity record — edit or re-import history and the totals follow."
      />
      <GearListView />
    </div>
  )
}

export default Page
