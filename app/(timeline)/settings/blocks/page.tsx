import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { getDatabase } from '@/lib/database'
import { getFallbackBlockedAccount } from '@/lib/services/accounts/getFallbackBlockedAccount'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { BlocksList } from './BlocksList'

export const dynamic = 'force-dynamic'
const BLOCKS_PAGE_LIMIT = 80

export const metadata: Metadata = {
  title: 'Activities.next: Blocked Accounts'
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

  const blocks = await database.getBlocks({
    actorId: actor.id,
    limit: BLOCKS_PAGE_LIMIT
  })
  const accounts = await Promise.all(
    blocks.map(async (block) => {
      const account = await database.getMastodonActorFromId({
        id: block.targetActorId
      })
      return account ?? getFallbackBlockedAccount(block)
    })
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Blocked Accounts"
        description="Manage actors hidden from your timelines and notifications."
      />

      <section className="space-y-4 rounded-2xl border bg-background/80 p-6 shadow-sm">
        <BlocksList
          accounts={accounts}
          nextMaxId={
            blocks.length === BLOCKS_PAGE_LIMIT
              ? (blocks[blocks.length - 1]?.id ?? null)
              : null
          }
        />
      </section>
    </div>
  )
}

export default Page
