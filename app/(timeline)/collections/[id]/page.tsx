import { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { CollectionMember } from '@/app/(timeline)/collections/CollectionEditor'
import { CollectionDetail } from '@/app/(timeline)/collections/[id]/CollectionDetail'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonCollection } from '@/lib/services/mastodon/getMastodonCollection'
import { Mastodon } from '@/lib/types/activitypub'
import { getActorProfile } from '@/lib/types/domain/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

// Initial feed page size — matches the list timeline.
const FEED_PAGE_LIMIT = 20
// Cap the roster shown inline; a collection's full membership is managed in the
// editor. Bounded so the detail render stays cheap.
const ROSTER_LIMIT = 80

interface PageProps {
  params: Promise<{ id: string }>
}

const toMember = (
  account: Mastodon.Account,
  host: string
): CollectionMember => ({
  id: account.id,
  name: account.display_name || account.username,
  handle: account.acct.includes('@') ? account.acct : `${account.acct}@${host}`,
  avatar: account.avatar
})

// A non-owner may view a collection only when it has a public projection: a
// public/unlisted visibility AND an enabled feed. Private (or feed-disabled)
// collections are owner-only.
const hasPublicProjection = (collection: {
  visibility: 'public' | 'unlisted' | 'private'
  publicFeed: boolean
}) => collection.visibility !== 'private' && collection.publicFeed

export const generateMetadata = async ({
  params
}: PageProps): Promise<Metadata> => {
  const database = getDatabase()
  if (!database) return { title: 'Activities.next: Collections' }
  const { id } = await params
  const collection = await database.getCollectionById({ id })
  return {
    title: collection
      ? `Activities.next: ${collection.title}`
      : 'Activities.next: Collections'
  }
}

const Page = async ({ params }: PageProps) => {
  const { host } = getConfig()
  const database = getDatabase()
  if (!database) {
    throw new Error('Failed to load database')
  }

  const { id } = await params
  const collection = await database.getCollectionById({ id })
  if (!collection) {
    return notFound()
  }

  const session = await getServerAuthSession()
  const viewer = await getActorFromSession(database, session)
  const isOwner = viewer?.id === collection.ownerActorId

  // Public/anonymous viewers can only see a collection with a public projection.
  if (!isOwner && !hasPublicProjection(collection)) {
    return notFound()
  }

  const ownerActorId = collection.ownerActorId
  const [approvedCounts, totalCounts] = await Promise.all([
    database.getCollectionMemberCounts({
      actorId: ownerActorId,
      collectionIds: [id],
      approvedOnly: true
    }),
    database.getCollectionMemberCounts({
      actorId: ownerActorId,
      collectionIds: [id],
      approvedOnly: false
    })
  ])
  const approvedCount = approvedCounts[id] ?? 0
  const totalCount = totalCounts[id] ?? 0

  // The approved (public) roster is needed for both the public view and the
  // owner's "Public preview"; the full roster only for the owner.
  const publicMembersPage = await database.getCollectionMembers({
    id,
    actorId: ownerActorId,
    projection: 'public',
    limit: ROSTER_LIMIT
  })
  const ownerMembersPage = isOwner
    ? await database.getCollectionMembers({
        id,
        actorId: ownerActorId,
        projection: 'owner',
        limit: ROSTER_LIMIT
      })
    : { accounts: [] as Mastodon.Account[] }

  // The default projection's initial feed: the owner sees their full feed; the
  // public sees the consent-gated projection.
  const statuses = isOwner
    ? await database.getCollectionTimeline({
        id,
        actorId: ownerActorId,
        projection: 'owner',
        limit: FEED_PAGE_LIMIT
      })
    : ((await database.getPublicCollectionTimeline({
        id,
        limit: FEED_PAGE_LIMIT
      })) ?? [])

  const ownerAccount = await database.getMastodonActorFromId({
    id: ownerActorId
  })
  const ownerHandle = ownerAccount
    ? toMember(ownerAccount, host).handle
    : collection.title
  const ownerProfilePath = `/@${ownerHandle}`

  const settings = viewer
    ? await database.getActorSettings({ actorId: viewer.id })
    : null

  const shareUrl = hasPublicProjection(collection)
    ? `https://${host}/collections/${id}`
    : null

  return (
    <CollectionDetail
      host={host}
      collection={getMastodonCollection(collection, approvedCount)}
      isOwner={isOwner}
      ownerHandle={ownerHandle}
      ownerProfilePath={ownerProfilePath}
      totalCount={totalCount}
      approvedCount={approvedCount}
      ownerRoster={ownerMembersPage.accounts.map((account) =>
        toMember(account, host)
      )}
      publicRoster={publicMembersPage.accounts.map((account) =>
        toMember(account, host)
      )}
      statuses={statuses.map((status) => cleanJson(status))}
      shareUrl={shareUrl}
      currentTime={Date.now()}
      currentActor={viewer ? getActorProfile(viewer) : undefined}
      postLineLimit={settings?.postLineLimit}
    />
  )
}

export default Page
