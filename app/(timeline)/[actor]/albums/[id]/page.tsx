import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ComponentProps, FC } from 'react'

import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'
import { profileName } from '@/lib/components/navigation-history/backDestination'
import { getDatabase } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  getGalleryAlbumShare,
  getGalleryAlbumView
} from '@/lib/services/gallery/galleryAlbumQueries'
import { getGalleryAlbumPublicUrl } from '@/lib/services/gallery/galleryAlbumUrls'
import { resolveGalleryAudience } from '@/lib/services/gallery/resolveGalleryAccount'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { Actor } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'

import { PublicGalleryAlbumView } from './PublicGalleryAlbumView'
import {
  UNAVAILABLE_ALBUM_METADATA,
  buildGalleryAlbumMetadata
} from './galleryAlbumMetadata'

export const dynamic = 'force-dynamic'

// The first page of the grid; "Load more" fetches the rest.
const PAGE_SIZE = 30

interface Props {
  params: Promise<{ actor: string; id: string }>
}

/**
 * The album owner named by the `@user@domain` segment: a local actor with an
 * account, or null. Remote actors have no albums here, and a missing actor is
 * indistinguishable from one.
 */
const loadOwner = async (
  database: Database,
  actorParam: string
): Promise<Actor | null> => {
  let handle: string
  try {
    handle = decodeURIComponent(actorParam)
  } catch {
    return null
  }
  if (!handle.startsWith('@')) return null
  const parts = handle.split('@').slice(1)
  if (parts.length !== 2) return null
  const [username, domain] = parts
  const owner = await database.getActorFromUsername({ username, domain })
  return owner?.account ? owner : null
}

// The link preview is computed for the logged-out audience only, whoever is
// asking (see `getGalleryAlbumShare`), and an album a logged-out visitor cannot
// open gets the same bare tags as a missing one.
export const generateMetadata = async ({
  params
}: Props): Promise<Metadata> => {
  const database = getDatabase()
  if (!database) return UNAVAILABLE_ALBUM_METADATA

  const { actor, id } = await params
  const owner = await loadOwner(database, actor)
  if (!owner) return UNAVAILABLE_ALBUM_METADATA

  const share = await getGalleryAlbumShare({ database, owner, albumId: id })
  if (!share) return UNAVAILABLE_ALBUM_METADATA

  const { instance } = await getResolvedServerSettings(database)
  const pageUrl = getGalleryAlbumPublicUrl({ actor: owner, albumId: id })
  return buildGalleryAlbumMetadata({
    share,
    ownerName: profileName(owner),
    siteName: instance.name,
    origin: new URL(pageUrl).origin,
    pageUrl
  })
}

const Page: FC<Props> = async ({ params }) => {
  const database = getDatabase()
  if (!database) throw new Error('Database is not available')

  const { actor, id } = await params
  const owner = await loadOwner(database, actor)
  if (!owner) return notFound()

  const session = await getServerAuthSession()
  const currentActor = await getActorFromSession(database, session)
  const audience = await resolveGalleryAudience({
    database,
    owner,
    currentActor
  })

  // A private album, a missing one and one with nothing this viewer can see
  // are the same not-found page.
  const view = await getGalleryAlbumView({
    database,
    owner,
    audience,
    albumId: id,
    limit: PAGE_SIZE
  })
  if (!view) return notFound()

  // The owner sees their own album here even when nobody else can open it.
  // Say so, or a link they shared before making it private looks fine to them
  // and a not-found page to everyone else. Visitors get no such check.
  const isOwner = currentActor?.id === owner.id
  const visibleToVisitors =
    !isOwner ||
    (view.album.visibility === 'public' &&
      (await getGalleryAlbumShare({ database, owner, albumId: id })) !== null)
  const ownerNotice: ComponentProps<
    typeof PublicGalleryAlbumView
  >['ownerNotice'] = visibleToVisitors
    ? undefined
    : {
        reason:
          view.album.visibility === 'public' ? 'nothing-public' : 'private',
        manageHref: `/gallery/albums/${encodeURIComponent(view.album.id)}`
      }

  return (
    <>
      {/* Signed in, below `md` the menu button lives in this bar (a page with
          no `PageHeader` renders it itself, like the status page); logged out
          it renders nothing, and `PublicShell` has its own top bar. */}
      <MobileCompactHeader title="Album" as="p" />
      <PublicGalleryAlbumView
        className={currentActor ? 'md:pt-8' : undefined}
        ownerId={owner.id}
        ownerName={profileName(owner)}
        profileHref={`/@${owner.username}@${owner.domain}`}
        pageUrl={getGalleryAlbumPublicUrl({
          actor: owner,
          albumId: view.album.id
        })}
        initial={view}
        ownerNotice={ownerNotice}
        pageSize={PAGE_SIZE}
      />
    </>
  )
}

export default Page
