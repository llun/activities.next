import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { CollectionEditor } from '@/app/(timeline)/collections/CollectionEditor'
import { toCollectionMember } from '@/app/(timeline)/collections/toCollectionMember'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonCollection } from '@/lib/services/mastodon/getMastodonCollection'
import { Mastodon } from '@/lib/types/activitypub'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Edit collection'
}

// Seed of followed accounts offered as add suggestions. The editor searches
// within this loaded set; full server-backed search across all accounts is a
// follow-up (matching the list editor).
const FOLLOWING_SUGGESTIONS_LIMIT = 200
// Page size + safety cap for loading the full member roster.
const MEMBER_PAGE_LIMIT = 80
const MAX_MEMBER_PAGES = 25

interface PageProps {
  params: Promise<{ id: string }>
}

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
  // Owner-scoped read: editing is owner-only, so a non-owner (or missing)
  // collection is a 404.
  const collection = await database.getCollection({ id, actorId: actor.id })
  if (!collection) {
    return notFound()
  }

  const approvedCounts = await database.getCollectionMemberCounts({
    actorId: actor.id,
    collectionIds: [id],
    approvedOnly: true
  })

  // Load the full roster (owner projection), paginating on the membership
  // cursor with a safety cap so a large collection can still be edited.
  const memberAccounts: Mastodon.Account[] = []
  let memberCursor: string | null = null
  for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
    const { accounts, nextMaxId } = await database.getCollectionMembers({
      id,
      actorId: actor.id,
      projection: 'owner',
      limit: MEMBER_PAGE_LIMIT,
      maxId: memberCursor
    })
    memberAccounts.push(...accounts)
    if (!nextMaxId) break
    memberCursor = nextMaxId
  }

  const follows = await database.getFollowing({
    actorId: actor.id,
    limit: FOLLOWING_SUGGESTIONS_LIMIT
  })
  const followingAccounts = await database.getMastodonActorsFromIds({
    ids: follows.map((follow) => follow.targetActorId)
  })

  return (
    <CollectionEditor
      mode="edit"
      collection={getMastodonCollection(collection, approvedCounts[id] ?? 0)}
      initialMembers={memberAccounts.map((account) =>
        toCollectionMember(account, host)
      )}
      followingSuggestions={followingAccounts.map((account) =>
        toCollectionMember(account, host)
      )}
    />
  )
}

export default Page
