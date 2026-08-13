import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { NavigationSettings } from '@/lib/components/settings/NavigationSettings'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Navigation'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const { features } = await getResolvedServerSettings(database)

  // Only the availability inputs: the order and hidden items come from the
  // shared store the (timeline) layout seeded, which is what keeps the sidebar
  // beside this page in step as it is edited.
  return (
    <NavigationSettings
      fitnessUrl="/fitness"
      isAdmin={actor.account.role === 'admin'}
      features={features}
    />
  )
}

export default Page
