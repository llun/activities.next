import { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { ListEditor, ListMember } from '@/app/(timeline)/lists/ListEditor'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonList } from '@/lib/services/mastodon/getMastodonList'
import { Mastodon } from '@/lib/types/activitypub'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Activities.next: Edit list'
}

// Seed of followed accounts offered as add suggestions. The editor searches
// within this loaded set, so keep it generous without unbounding the query.
// (Full server-backed search across all follows is a follow-up.)
const FOLLOWING_SUGGESTIONS_LIMIT = 200
// Page size + safety cap for loading the full member list. We load every member
// (not just the first page) so even large lists can be fully viewed and edited.
const MEMBER_PAGE_LIMIT = 80
const MAX_MEMBER_PAGES = 25

interface PageProps {
  params: Promise<{ id: string }>
}

const toListMember = (account: Mastodon.Account, host: string): ListMember => ({
  // Mastodon Account `id` (the `urlToId`-encoded actor id, not the raw URI).
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

  // Load every member, not just the first page, so a large list can still be
  // fully viewed and edited. Paginate on the membership cursor with a safety cap.
  const memberAccounts: Mastodon.Account[] = []
  let memberCursor: string | null = null
  for (let page = 0; page < MAX_MEMBER_PAGES; page++) {
    const { accounts, nextMaxId } = await database.getListAccounts({
      listId: id,
      actorId: actor.id,
      limit: MEMBER_PAGE_LIMIT,
      maxId: memberCursor
    })
    memberAccounts.push(...accounts)
    // Break on the membership-row cursor, not accounts.length: a full page can
    // hydrate to fewer accounts when a member's actor row is missing, which
    // would otherwise stop pagination early and drop later members.
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
