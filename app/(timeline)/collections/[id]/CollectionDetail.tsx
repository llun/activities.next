'use client'

import {
  ArrowLeft,
  Check,
  Copy,
  Eye,
  Globe,
  Hash,
  Layers,
  Link2,
  Lock,
  Pencil
} from 'lucide-react'
import Link from 'next/link'
import { FC, useCallback, useRef, useState } from 'react'

import { CollectionMember } from '@/app/(timeline)/collections/CollectionEditor'
import { getCollectionFeed, getCollectionTimeline } from '@/lib/client'
import { PageHeader } from '@/lib/components/page-header'
import { Posts } from '@/lib/components/posts/posts'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
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
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
      <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
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
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
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
  const subtitle = isOwner
    ? `${totalCount} ${totalCount === 1 ? 'person' : 'people'} · ${approvedCount} featured publicly`
    : `by ${ownerHandle}`

  return (
    <div className="space-y-6">
      <ScrollToTopButton
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {isOwner ? (
              <Link
                href="/lists"
                aria-label="Back to lists and collections"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
            ) : null}
            <span className="truncate">{collection.title}</span>
          </span>
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

      {/* Projection toggle — owner only, to preview the consent-gated link. */}
      {isOwner && shareUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-muted p-0.5">
            {(
              [
                ['owner', 'Owner view', Eye],
                ['public', 'Public preview', Globe]
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchProjection(value)}
                aria-pressed={projection === value}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  projection === value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {projection === 'owner'
              ? `Showing all ${totalCount}`
              : `Showing ${approvedCount} of ${totalCount}`}
          </span>
        </div>
      )}

      {/* Meta panel — visibility, topic, description, share link. */}
      <section className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <VisibilityIcon className="h-3 w-3" />
            {visibility.label}
          </span>
          {collection.topic && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <Hash className="h-3 w-3" />
              {collection.topic}
            </span>
          )}
        </div>
        {collection.description && (
          <p className="text-sm leading-relaxed text-foreground">
            {collection.description}
          </p>
        )}
        {shareUrl && <ShareRow url={shareUrl} />}
        {isOwner && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {shareUrl
              ? projection === 'owner'
                ? 'Owner view — you see everyone. The public link shows only members who approved being featured.'
                : 'Public preview — exactly what people opening your link see: approved members and their public posts.'
              : 'Private — there is no public link. Members and posts are visible to you only.'}
          </p>
        )}
      </section>

      {currentStatuses.length > 0 ? (
        <Posts
          host={host}
          currentTime={currentTime}
          statuses={currentStatuses}
          currentActor={currentActor}
          showActions={Boolean(currentActor)}
          isMediaUploadEnabled={isMediaUploadEnabled}
          postLineLimit={postLineLimit}
          onPostDeleted={removeStatus}
        />
      ) : (
        <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground shadow-sm">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Layers className="h-6 w-6" />
          </span>
          <h2 className="mb-2 text-xl font-semibold text-foreground">
            {totalCount === 0
              ? 'No one in this collection yet'
              : projection === 'public'
                ? 'Nothing public yet'
                : 'No posts yet'}
          </h2>
          <p>
            {totalCount === 0
              ? isOwner
                ? 'Add people you want to highlight — their recent posts will fan into this feed.'
                : 'This collection does not feature anyone yet.'
              : projection === 'public'
                ? 'No featured member has posted yet, or no one has approved being featured.'
                : 'Members’ posts will appear here as they’re published.'}
          </p>
        </div>
      )}

      {hasMoreStatuses && lastStatusIdRef.current && (
        <div ref={loadMoreRef} className="text-center">
          <Button
            variant="outline"
            disabled={isLoadingMoreStatuses}
            onClick={loadMoreStatuses}
          >
            {isLoadingMoreStatuses ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}

      {/* Roster — highlighted accounts. */}
      {roster.length > 0 && (
        <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-xs font-semibold">
              Highlighted accounts · {roster.length}
            </span>
            {isOwner &&
              projection === 'public' &&
              approvedCount < totalCount && (
                <span className="text-xs text-muted-foreground">
                  {totalCount - approvedCount} hidden by consent
                </span>
              )}
          </div>
          <ul className="divide-y">
            {roster.map((member) => (
              <li
                key={member.id}
                className="flex items-center gap-3 px-4 py-2.5"
              >
                <Avatar className="h-9 w-9">
                  {member.avatar && <AvatarImage src={member.avatar} />}
                  <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                </Avatar>
                <Link href={`/@${member.handle}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium hover:underline">
                    {member.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    @{member.handle}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isOwner && (
        <p className="px-1 text-xs text-muted-foreground">
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
