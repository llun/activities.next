import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonList } from '@/lib/services/mastodon/getMastodonList'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { ListSummary, ListsIndex } from './ListsIndex'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Lists'
}

// How many member avatars to preview per list row in the index. The design
// shows a small stacked cluster, so a tight cap keeps the per-list fetch cheap.
const PREVIEW_MEMBERS = 3

const Page = async () => {
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const session = await getServerAuthSession()
  const actor = await getActorFromSession(database, session)
  if (!actor) {
    return redirect('/auth/signin')
  }

  const lists = await database.getLists({ actorId: actor.id })
  const counts = await database.getListAccountCounts({
    actorId: actor.id,
    listIds: lists.map((list) => list.id)
  })

  // Member counts are batched in one grouped query above; the avatar previews
  // need the hydrated accounts, so fetch a tiny page per list. Lists are few
  // per account, so this stays a small bounded number of queries.
  const summaries: ListSummary[] = await Promise.all(
    lists.map(async (list) => {
      const { accounts } = await database.getListAccounts({
        listId: list.id,
        actorId: actor.id,
        limit: PREVIEW_MEMBERS
      })
      return {
        ...getMastodonList(list),
        memberCount: counts[list.id] ?? 0,
        previewMembers: accounts.map((account) => ({
          id: account.id,
          name: account.display_name || account.username,
          avatar: account.avatar
        }))
      }
    })
  )

  return <ListsIndex lists={summaries} />
}

export default Page
