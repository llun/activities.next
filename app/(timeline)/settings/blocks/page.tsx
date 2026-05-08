import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { BlocksList } from './BlocksList'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: Blocked Accounts'
}

const isMastodonAccount = (
  account: MastodonAccount | null
): account is MastodonAccount => account !== null

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

  const blocks = await database.getBlocks({
    actorId: actor.id,
    limit: 80
  })
  const accounts = await Promise.all(
    blocks.map((block) =>
      database.getMastodonActorFromId({ id: block.targetActorId })
    )
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Blocked Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Manage actors hidden from your timelines and notifications.
        </p>
      </div>

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <BlocksList accounts={accounts.filter(isMastodonAccount)} />
      </section>
    </div>
  )
}

export default Page
