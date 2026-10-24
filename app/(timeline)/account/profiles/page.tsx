import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { ActorsSection } from '@/lib/components/settings/ActorsSection'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Profiles'
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

  const account = actor.account
  const actors = await database.getActorsForAccount({
    accountId: account.id
  })
  const count = actors.length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profiles"
        description={`${count} ${count === 1 ? 'profile' : 'profiles'} on this account. They share its email, password and security.`}
      />

      <ActorsSection
        currentActor={{
          id: actor.id,
          username: actor.username,
          domain: actor.domain,
          name: actor.name,
          iconUrl: isRealAvatar(actor.iconUrl) ? actor.iconUrl : null,
          deletionStatus: actor.deletionStatus ?? null,
          deletionScheduledAt: actor.deletionScheduledAt ?? null
        }}
        actors={actors.map((actorItem) => ({
          id: actorItem.id,
          username: actorItem.username,
          domain: actorItem.domain,
          name: actorItem.name,
          iconUrl: isRealAvatar(actorItem.iconUrl) ? actorItem.iconUrl : null,
          deletionStatus: actorItem.deletionStatus ?? null,
          deletionScheduledAt: actorItem.deletionScheduledAt ?? null
        }))}
        currentDefault={account.defaultActorId || null}
      />
    </div>
  )
}

export default Page
