import { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Wahoo Settings'
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

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Wahoo Integration</h2>
          <p className="text-sm text-muted-foreground">
            Connect your Wahoo account to automatically post your activities to
            your timeline.
          </p>
        </div>

        <div className="rounded-lg bg-blue-50 p-6 text-center dark:bg-blue-900/20">
          <div className="mb-2 text-4xl">🚴‍♂️</div>
          <h3 className="mb-2 text-lg font-semibold text-blue-900 dark:text-blue-100">
            Coming Soon
          </h3>
          <p className="text-sm text-blue-800 dark:text-blue-200">
            Wahoo integration is currently under development. Check back later
            for updates.
          </p>
        </div>
      </section>
    </div>
  )
}

export default Page
