'use client'

import {
  Check,
  Copy,
  Eye,
  Globe,
  Hash,
  Layers,
  Link2,
  Lock,
  Pencil,
  UserPlus
} from 'lucide-react'
import Link from 'next/link'
import { FC, useCallback, useRef, useState } from 'react'

import { CollectionMember } from '@/app/(timeline)/collections/CollectionEditor'
import { getCollectionFeed, getCollectionTimeline } from '@/lib/client'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { PageHeader } from '@/lib/components/page-header'
import { MOBILE_INSET_FEED_CLASS } from '@/lib/components/posts/feedLayout'
import { Posts } from '@/lib/components/posts/posts'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Frame } from '@/lib/components/surface/Frame'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Section } from '@/lib/components/surface/Section'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { CollectionEntity } from '@/lib/types/mastodon/collection'
import { cn } from '@/lib/utils'

type Projection = 'owner' | 'public'

const VISIBILITY_META: Record<
  CollectionEntity['visibility'],
  { label: string; icon: typeof Globe }
> = {
  public: { label: 'Public', icon: Globe },
  unlisted: { label: 'Unlisted', icon: Link2 },
  private: { label: 'Private', icon: Lock }
}

const PROJECTION_ITEMS = [
  { value: 'owner', label: 'Owner view', icon: Eye },
  { value: 'public', label: 'Public preview', icon: Globe }
]

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

interface ShareRowProps {
  url: string
}

const ShareRow: FC<ShareRowProps> = ({ url }) => {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard can reject (permissions / insecure context); leave the link
      // visible so it can still be copied manually.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Link2 className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {url}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        onClick={copy}
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  )
}

interface CollectionDetailProps {
  host: string
  collection: CollectionEntity
  isOwner: boolean
  // The owner's full handle (@user@domain) shown on the public view.
  ownerHandle: string
  ownerProfilePath: string
  totalCount: number
  approvedCount: number
  // Owner projection roster (all members) — owner only.
  ownerRoster: CollectionMember[]
  // Public projection roster (approved members) — shown to the public and in the
  // owner's "Public preview".
  publicRoster: CollectionMember[]
  // Initial feed page for the initial projection (owner feed for the owner,
  // public feed otherwise).
  statuses: Status[]
  shareUrl: string | null
  currentTime: number
  currentActor?: ActorProfile
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
}

export const CollectionDetail: FC<CollectionDetailProps> = ({
  host,
  collection,
  isOwner,
  ownerHandle,
  ownerProfilePath,
  totalCount,
  approvedCount,
  ownerRoster,
  publicRoster,
  statuses,
  shareUrl,
  currentTime,
  currentActor,
  isMediaUploadEnabled,
  postLineLimit
}) => {
  const initialProjection: Projection = isOwner ? 'owner' : 'public'
  const [projection, setProjection] = useState<Projection>(initialProjection)
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(
    statuses.length > 0
  )
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] = useState(false)
  const isLoadingRef = useRef(false)
  // Monotonic token tagging the latest feed request. A projection toggle and an
  // in-flight load-more (or a rapid double-toggle) both mutate the feed state;
  // each async path captures the token at start and only applies its result when
  // it is still the latest, so a stale response can't append the wrong
  // projection's posts or desync the cursor from `projection`.
  const requestIdRef = useRef(0)
  const lastStatusIdRef = useRef<string | null>(
    statuses.length > 0 ? statuses[statuses.length - 1].id : null
  )

  const fetchPage = useCallback(
    (next: Projection, maxStatusId?: string) =>
      next === 'public'
        ? getCollectionFeed({ collectionId: collection.id, maxStatusId })
        : getCollectionTimeline({ collectionId: collection.id, maxStatusId }),
    [collection.id]
  )

  const switchProjection = async (next: Projection) => {
    if (next === projection) return
    const previous = projection
    setProjection(next)
    const requestId = ++requestIdRef.current
    setLoadingMoreStatuses(true)
    isLoadingRef.current = true
    try {
      const result = await fetchPage(next)
      if (requestId !== requestIdRef.current) return
      setCurrentStatuses(result.statuses)
      lastStatusIdRef.current =
        result.statuses.length > 0
          ? result.statuses[result.statuses.length - 1].id
          : null
      setHasMoreStatuses(Boolean(result.nextMaxStatusId))
    } catch {
      // Revert the projection on failure so the toggle, roster, feed and cursor
      // stay consistent (the old feed + cursor are still in place). Only revert
      // if this is still the latest request, so we don't clobber a newer switch.
      if (requestId === requestIdRef.current) setProjection(previous)
    } finally {
      // Only the latest request owns the loading flags; a superseded request
      // must not clear them out from under the one that replaced it.
      if (requestId === requestIdRef.current) {
        isLoadingRef.current = false
        setLoadingMoreStatuses(false)
      }
    }
  }

  const removeStatus = (status: Status) =>
    setCurrentStatuses((previous) =>
      previous.filter((item) => item.id !== status.id)
    )

  const updateStatus = (status: Status) =>
    setCurrentStatuses((previous) =>
      previous.map((item) => (item.id === status.id ? status : item))
    )

  const loadMoreStatuses = useCallback(async () => {
    const maxStatusId = lastStatusIdRef.current
    if (isLoadingRef.current || !maxStatusId) return

    const requestId = ++requestIdRef.current
    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    try {
      const result = await fetchPage(projection, maxStatusId)
      if (requestId !== requestIdRef.current) return
      if (result.statuses.length === 0) {
        setHasMoreStatuses(false)
        return
      }
      lastStatusIdRef.current = result.statuses[result.statuses.length - 1].id
      setHasMoreStatuses(Boolean(result.nextMaxStatusId))
      setCurrentStatuses((previous) => [...previous, ...result.statuses])
    } catch {
      // Error loading more — the user can retry via the button.
    } finally {
      if (requestId === requestIdRef.current) {
        isLoadingRef.current = false
        setLoadingMoreStatuses(false)
      }
    }
  }, [fetchPage, projection])

  const { loadMoreRef, isLoadMoreVisible } = useLoadMoreOnVisible({
    enabled: hasMoreStatuses,
    onLoadMore: loadMoreStatuses
  })

  const visibility = VISIBILITY_META[collection.visibility]
  const VisibilityIcon = visibility.icon
  const roster = projection === 'owner' ? ownerRoster : publicRoster
  // Only a logged-out visitor opens the page without the signed-in chrome (the
  // owner is always signed in).
  const isLoggedOutVisitor = !isOwner && !currentActor
  const subtitle = isOwner
    ? `${totalCount} ${totalCount === 1 ? 'person' : 'people'} · ${approvedCount} featured publicly`
    : `by ${ownerHandle}`

  return (
    <div className="space-y-6">
      <ScrollToTopButton
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      {isLoggedOutVisitor ? (
        // A logged-out visitor has no navigation, so `PageHeader` would be a
        // full-width band with its own background and divider between the top
        // bar and the first card, and its title row is centred in a column
        // wider than `PublicShell`'s. The heading is plain text in the same
        // column as the cards instead, 24px under the top bar (`PublicShell`'s
        // `py-6`) and 16px above the first card (`mb-4` in place of the
        // stack's 24px).
        <div className="mb-4">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {collection.title}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
      ) : (
        <PageHeader
          title={
            isOwner ? (
              // `PageHeader` truncates it beside the desktop Back arrow.
              collection.title
            ) : (
              // A signed-in visitor has no Back, so no `back` to make
              // `PageHeader` truncate: keep the heading this page always had,
              // truncating on one line. Below `md` it is the content's own
              // heading under the "Collection" bar, so a long title wraps
              // instead.
              <span className="flex items-center gap-2">
                <span className="truncate max-md:break-words max-md:whitespace-normal">
                  {collection.title}
                </span>
              </span>
            )
          }
          compactTitle="Collection"
          back={
            isOwner
              ? {
                  href: '/lists',
                  accessibleName: 'Back to lists and collections'
                }
              : undefined
          }
          description={subtitle}
          actions={
            isOwner ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/collections/${collection.id}/edit`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Projection toggle — owner only, to preview the consent-gated link. */}
      {isOwner && shareUrl && (
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            size="sm"
            aria-label="Collection view"
            items={PROJECTION_ITEMS}
            value={projection}
            onValueChange={(value) => switchProjection(value as Projection)}
          />
          <span className="text-xs text-muted-foreground">
            {projection === 'owner'
              ? `Showing all ${totalCount}`
              : `Showing ${approvedCount} of ${totalCount}`}
          </span>
        </div>
      )}

      {/* Meta panel — visibility, topic, description, share link. */}
      <Frame divided>
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="gray">
              <VisibilityIcon className="size-3" />
              {visibility.label}
            </Badge>
            {collection.topic && (
              <Badge tone="primary" className="gap-0.5">
                <Hash className="size-3" />
                {collection.topic}
              </Badge>
            )}
          </div>
          {collection.description && (
            <p className="text-sm leading-relaxed text-foreground">
              {collection.description}
            </p>
          )}
        </div>
        {shareUrl && (
          <div className="px-4 py-3">
            <ShareRow url={shareUrl} />
          </div>
        )}
        {isOwner && (
          <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            {shareUrl
              ? projection === 'owner'
                ? 'Owner view — you see everyone. The public link shows only members who approved being featured.'
                : 'Public preview — exactly what people opening your link see: approved members and their public posts.'
              : 'Private — there is no public link. Members and posts are visible to you only.'}
          </p>
        )}
      </Frame>

      {currentStatuses.length > 0 ? (
        <Posts
          host={host}
          currentTime={currentTime}
          statuses={currentStatuses}
          currentActor={currentActor}
          showActions={Boolean(currentActor)}
          showReadOnlyStats={!currentActor}
          // A logged-out visitor's feed is an inset card below `md`, like the
          // cards around it; signed in it stays the full-bleed surface.
          className={isLoggedOutVisitor ? MOBILE_INSET_FEED_CLASS : undefined}
          isMediaUploadEnabled={isMediaUploadEnabled}
          postLineLimit={postLineLimit}
          onPostDeleted={removeStatus}
          onPostUpdated={updateStatus}
        />
      ) : (
        <EmptyState
          icon={Layers}
          titleAs="h2"
          title={
            totalCount === 0
              ? 'No one in this collection yet'
              : projection === 'public'
                ? 'Nothing public yet'
                : 'No posts yet'
          }
          action={
            isOwner && totalCount === 0 ? (
              <Button asChild size="sm">
                <Link href={`/collections/${collection.id}/edit`}>
                  <UserPlus className="size-4" />
                  Add people
                </Link>
              </Button>
            ) : undefined
          }
        >
          {totalCount === 0
            ? isOwner
              ? 'Add people you want to highlight — their recent posts will fan into this feed.'
              : 'This collection does not feature anyone yet.'
            : projection === 'public'
              ? 'No featured member has posted yet, or no one has approved being featured.'
              : 'Members’ posts will appear here as they’re published.'}
        </EmptyState>
      )}

      {hasMoreStatuses && lastStatusIdRef.current && (
        <LoadMoreButton
          containerRef={loadMoreRef}
          isLoading={isLoadingMoreStatuses}
          onClick={loadMoreStatuses}
        />
      )}

      {/* Roster — highlighted accounts. */}
      {roster.length > 0 && (
        <Section
          title="Highlighted accounts"
          meta={roster.length}
          actions={
            isOwner && projection === 'public' && approvedCount < totalCount ? (
              <span className="text-xs text-muted-foreground">
                {totalCount - approvedCount} hidden by consent
              </span>
            ) : undefined
          }
        >
          <FramedList>
            {roster.map((member) => (
              <FramedListItem
                key={member.id}
                className="flex items-center gap-3 py-2.5"
              >
                <Avatar className="size-9">
                  {member.avatar && <AvatarImage src={member.avatar} />}
                  <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                </Avatar>
                <Link
                  href={`/@${member.handle}`}
                  prefetch={false}
                  className="min-w-0 flex-1"
                >
                  <p className="truncate text-sm font-medium hover:underline">
                    {member.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{member.handle}
                  </p>
                </Link>
              </FramedListItem>
            ))}
          </FramedList>
        </Section>
      )}

      {!isOwner && (
        <p
          className={cn(
            'px-1 text-xs text-muted-foreground',
            // Level with the cards' edge in the logged-out phone column.
            isLoggedOutVisitor && 'max-md:px-0'
          )}
        >
          Curated by{' '}
          <Link
            href={ownerProfilePath}
            className="font-medium text-foreground hover:underline"
          >
            {ownerHandle}
          </Link>
          .
        </p>
      )}
    </div>
  )
}
