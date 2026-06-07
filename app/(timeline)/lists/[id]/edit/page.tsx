import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonList } from '@/lib/services/mastodon/getMastodonList'
import { Mastodon } from '@/lib/types/activitypub'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ListEditor, ListMember } from '../../ListEditor'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Edit list'
}

// Seed of followed accounts offered as add suggestions. The editor searches
// within this loaded set, so keep it generous without unbounding the query.
const FOLLOWING_SUGGESTIONS_LIMIT = 200

interface PageProps {
  params: Promise<{ id: string }>
}

const toListMember = (account: Mastodon.Account, host: string): ListMember => ({
  id: account.id,
  name: account.display_name || account.username,
  // `acct` is bare username for local accounts; qualify it with the instance
  // host so members always render as a full @user@domain handle.
  handle: account.acct.includes('@') ? account.acct : `${account.acct}@${host}`,
  avatar: account.avatar
})

const Page = async ({ params }: PageProps) => {
  const { host } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const { id } = await params
  const list = await database.getList({ id, actorId: actor.id })
  if (!list) {
    return notFound()
  }

  const { accounts: memberAccounts } = await database.getListAccounts({
    listId: id,
    actorId: actor.id,
    limit: 80
  })
  const follows = await database.getFollowing({
    actorId: actor.id,
    limit: FOLLOWING_SUGGESTIONS_LIMIT
  })
  const followingAccounts = await database.getMastodonActorsFromIds({
    ids: follows.map((follow) => follow.targetActorId)
  })

  return (
    <ListEditor
      mode="edit"
      list={getMastodonList(list)}
      initialMembers={memberAccounts.map((account) =>
        toListMember(account, host)
      )}
      followingSuggestions={followingAccounts.map((account) =>
        toListMember(account, host)
      )}
    />
  )
}

export default Page
