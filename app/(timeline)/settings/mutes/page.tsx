import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getFallbackMutedAccount } from '@/lib/services/accounts/getFallbackMutedAccount'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { MutesList } from './MutesList'

export const dynamic = 'force-dynamic'
const MUTES_PAGE_LIMIT = 80

export const metadata: Metadata = {
  title: 'Activities.next: Muted Accounts'
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

  const mutes = await database.getMutes({
    actorId: actor.id,
    limit: MUTES_PAGE_LIMIT
  })
  const accounts = await Promise.all(
    mutes.map(async (mute) => {
      const account = await database.getMastodonActorFromId({
        id: mute.targetActorId
      })
      return account ?? getFallbackMutedAccount(mute)
    })
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Muted Accounts"
        description="Manage actors hidden from your timelines and notifications."
      />

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <MutesList
          accounts={accounts}
          nextMaxId={
            mutes.length === MUTES_PAGE_LIMIT
              ? (mutes[mutes.length - 1]?.id ?? null)
              : null
          }
        />
      </section>
    </div>
  )
}

export default Page
