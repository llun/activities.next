import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { DeleteActorSection } from '@/lib/components/settings/DeleteActorSection'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Delete this profile'
}

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Fail to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor || !actor.account) {
    return redirect('/auth/signin')
  }

  const actors = await database.getActorsForAccount({
    accountId: actor.account.id
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delete this profile"
        description="Irreversible actions for this profile."
      />

      <DeleteActorSection
        actorId={actor.id}
        actorUsername={actor.username}
        actorDomain={actor.domain}
        isDefaultActor={actor.account.defaultActorId === actor.id}
        isOnlyActor={actors.filter((a) => !a.deletionStatus).length <= 1}
        deletionStatus={actor.deletionStatus ?? null}
      />
    </div>
  )
}

export default Page
