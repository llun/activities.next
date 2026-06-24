import { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonCollection } from '@/lib/services/mastodon/getMastodonCollection'
import { getMastodonList } from '@/lib/services/mastodon/getMastodonList'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { CollectionSummary, ListSummary, ListsIndex } from './ListsIndex'

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

  const collections = await database.getCollections({ actorId: actor.id })
  const collectionIds = collections.map((collection) => collection.id)
  // Approved (public) and total member counts are each a single grouped query.
  // The collection entity's `size` carries the approved count; `memberCount`
  // carries the total shown in the index row ("N people · M featured publicly").
  const [approvedCounts, totalCounts] = await Promise.all([
    database.getCollectionMemberCounts({
      actorId: actor.id,
      collectionIds,
      approvedOnly: true
    }),
    database.getCollectionMemberCounts({
      actorId: actor.id,
      collectionIds,
      approvedOnly: false
    })
  ])
  const collectionSummaries: CollectionSummary[] = collections.map(
    (collection) => ({
      ...getMastodonCollection(collection, approvedCounts[collection.id] ?? 0),
      memberCount: totalCounts[collection.id] ?? 0
    })
  )

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

  return <ListsIndex lists={summaries} collections={collectionSummaries} />
}

export default Page
