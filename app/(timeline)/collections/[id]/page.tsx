import { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { CollectionDetail } from '@/app/(timeline)/collections/[id]/CollectionDetail'
import { toCollectionMember } from '@/app/(timeline)/collections/toCollectionMember'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getMastodonCollection } from '@/lib/services/mastodon/getMastodonCollection'
import { Mastodon } from '@/lib/types/activitypub'
import { getActorProfile } from '@/lib/types/domain/actor'
import { Collection } from '@/lib/types/domain/collection'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

export const dynamic = 'force-dynamic'

// Initial feed page size — matches the list timeline.
const FEED_PAGE_LIMIT = 20
// Cap the roster shown inline; a collection's full membership is managed in the
// editor. Bounded so the detail render stays cheap.
const ROSTER_LIMIT = 80

const GENERIC_TITLE = 'Activities.next: Collections'

interface PageProps {
  params: Promise<{ id: string }>
}

// A non-owner may view a collection only when it has a public projection: a
// public/unlisted visibility AND an enabled feed. Private (or feed-disabled)
// collections are owner-only.
const hasPublicProjection = (
  collection: Pick<Collection, 'visibility' | 'publicFeed'>
) => collection.visibility !== 'private' && collection.publicFeed

export const generateMetadata = async ({
  params
}: PageProps): Promise<Metadata> => {
  const database = getDatabase()
  if (!database) return { title: GENERIC_TITLE }
  const { id } = await params
  const collection = await database.getCollectionById({ id })
  if (!collection) return { title: GENERIC_TITLE }

  // Do not leak a private collection's title via the page <title>: only expose
  // it to the owner or when it has a public projection (mirrors the page's own
  // visibility gate below).
  const session = await getServerAuthSession()
  const viewer = await getActorFromSession(database, session)
  const isOwner = viewer?.id === collection.ownerActorId
  const visible = isOwner || hasPublicProjection(collection)
  return {
    title: visible ? `Activities.next: ${collection.title}` : GENERIC_TITLE
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
    ? toCollectionMember(ownerAccount, host).handle
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
      // Never serialize the raw total (incl. non-consenting members) to a
      // non-owner client payload — combined with approvedCount it would let
      // them recompute the hidden-by-consent count. Non-owner paths only use
      // totalCount as a `=== 0` empty-state check, so approvedCount is a safe
      // stand-in there.
      totalCount={isOwner ? totalCount : approvedCount}
      approvedCount={approvedCount}
      ownerRoster={ownerMembersPage.accounts.map((account) =>
        toCollectionMember(account, host)
      )}
      publicRoster={publicMembersPage.accounts.map((account) =>
        toCollectionMember(account, host)
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
