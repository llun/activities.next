'use client'

import {
  Activity,
  FileText,
  Images,
  type LucideIcon,
  MessageCircle
} from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { getAccountStatusesPage, getActorStatuses } from '@/lib/client'
import {
  createPreloadable,
  runWhenIdle
} from '@/lib/components/lazy/createPreloadable'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { Posts } from '@/lib/components/posts/posts'
import {
  removeOriginalStatus,
  updateMatchingStatus
} from '@/lib/components/posts/statusArray'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { Button } from '@/lib/components/ui/button'
import type { GallerySubview } from '@/lib/services/gallery/galleryEntities'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment, isVisualAttachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  StatusType
} from '@/lib/types/domain/status'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

const loadActorMediaGallery = () =>
  import('./ActorMediaGallery').then((module) => module.ActorMediaGallery)
const loadProfileGalleryTab = () =>
  import('./ProfileGalleryTab').then((module) => module.ProfileGalleryTab)

// The default tab is posts, so the gallery panels (and the map behind the
// gallery tab) load on demand. SSR stays on: a media-only profile renders the
// gallery as its primary content. Hovering or focusing the tab bar preloads them.
const galleryFallback = (
  <SectionSkeleton sections={[3]} headings={false} descriptions={false} />
)
const DynamicActorMediaGallery = dynamic(loadActorMediaGallery, {
  loading: () => galleryFallback
})
const DynamicProfileGalleryTab = dynamic(loadProfileGalleryTab, {
  loading: () => galleryFallback
})

// Render synchronously once preloaded; see `createPreloadable`. On the server
// and during hydration nothing is preloaded, so the SSR'd dynamic path renders.
const { Component: ActorMediaGallery, preload: preloadActorMediaGallery } =
  createPreloadable(loadActorMediaGallery, DynamicActorMediaGallery)
const { Component: ProfileGalleryTab, preload: preloadProfileGalleryTab } =
  createPreloadable(loadProfileGalleryTab, DynamicProfileGalleryTab)

const preloadGalleryPanels = () => {
  void preloadActorMediaGallery()
  void preloadProfileGalleryTab()
}

interface Props {
  host: string
  actorId: string
  /**
   * The profile shows a cover image above the tabs. That image is the likely
   * largest contentful paint, so the posts list then keeps its media lazy.
   */
  hasHeaderImage?: boolean
  currentTime: number
  statuses: Status[]
  attachments: Attachment[]
  /**
   * A remote actor's feed pages through outbox collection pages
   * (`nextPageUrl`); a local account's through its stored statuses with a
   * Mastodon-style `max_id` cursor (`nextMaxStatusId`).
   */
  statusPagination?: {
    nextPageUrl: string | null
    prevPageUrl: string | null
    nextMaxStatusId?: string | null
  }
  postLineLimit?: PostLineLimit
  /**
   * The signed-in viewer's profile. When present the feed renders interactive
   * post actions (reply/boost/like/bookmark); when absent (logged-out) it
   * falls back to read-only engagement counts.
   */
  currentActor?: ActorProfile
  /** True when the signed-in viewer is looking at their own profile. */
  isCurrentUser?: boolean
  /**
   * Whether this actor has any fitness activities. Drives whether the Fitness
   * tab is offered at all (it lists the actor's public fitness posts).
   */
  hasFitnessData?: boolean
  /**
   * Whether the viewer may see any of this actor's gallery photos. Drives
   * whether the Gallery tab is offered; `gallerySubviews` lists the views the
   * viewer may open in it.
   */
  hasGalleryMedia?: boolean
  gallerySubviews?: GallerySubview[]
  /** `@user@domain`, for links to the posts behind gallery map points. */
  handle?: string
  mapProvider?: PublicMapProvider
  isMediaUploadEnabled?: boolean
  isPixelfed?: boolean
  isMediaService?: boolean
  isInternalAccount?: boolean
  isMediaOnly?: boolean
}

const LOAD_MORE_PAGE_LIMIT = 5

type ProfileTab = 'posts' | 'replies' | 'media' | 'gallery' | 'fitness'

const isReply = (status: Status) => {
  switch (status.type) {
    case StatusType.enum.Note:
    case StatusType.enum.Poll:
      return !!status.reply
    case StatusType.enum.Announce:
      return false
    default:
      return false
  }
}

const hasFitnessFile = (status: Status) =>
  status.type === StatusType.enum.Note && Boolean(status.fitness)

const appendUniqueStatuses = (
  previousStatuses: Status[],
  nextStatuses: Status[]
) => {
  const statusIds = new Set(previousStatuses.map((status) => status.id))
  return [
    ...previousStatuses,
    ...nextStatuses.filter((status) => {
      if (statusIds.has(status.id)) return false
      statusIds.add(status.id)
      return true
    })
  ]
}

const PROFILE_TAB_LABELS: Record<ProfileTab, string> = {
  posts: 'Posts',
  replies: 'Replies',
  media: 'Media',
  gallery: 'Gallery',
  fitness: 'Fitness'
}

export const ActorTimelines: FC<Props> = ({
  host,
  actorId,
  currentTime,
  statuses,
  attachments,
  statusPagination,
  postLineLimit,
  currentActor,
  isCurrentUser = false,
  hasFitnessData = false,
  hasGalleryMedia = false,
  gallerySubviews = [],
  handle,
  mapProvider = { type: 'osm' },
  isMediaUploadEnabled,
  isPixelfed = false,
  isMediaService = false,
  isInternalAccount = true,
  isMediaOnly: isMediaOnlyProp = false,
  hasHeaderImage = false
}) => {
  const isMediaOnly = Boolean(isPixelfed || isMediaService || isMediaOnlyProp)
  const [currentStatuses, setCurrentStatuses] = useState<Status[]>(statuses)
  const [currentStatusPagination, setCurrentStatusPagination] = useState({
    nextPageUrl: statusPagination?.nextPageUrl ?? null,
    prevPageUrl: statusPagination?.prevPageUrl ?? null,
    nextMaxStatusId: statusPagination?.nextMaxStatusId ?? null
  })
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [requireManualLoadMore, setRequireManualLoadMore] =
    useState<boolean>(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const isLoadingRef = useRef<boolean>(false)

  const showActions = Boolean(currentActor)
  const showFitnessTab = Boolean(hasFitnessData)
  const showGalleryTab = Boolean(hasGalleryMedia) && gallerySubviews.length > 0
  const showRepliesTab = Boolean(isInternalAccount)

  const mediaAttachments = useMemo(() => {
    const statusAttachments = currentStatuses
      .flatMap((status) =>
        status.type === StatusType.enum.Note ? status.attachments : []
      )
      .filter(isVisualAttachment)
    if (attachments.length === 0) {
      return statusAttachments
    }
    const seenIds = new Set(attachments.map((a) => a.id))
    const newAttachments = statusAttachments.filter((a) => !seenIds.has(a.id))
    return newAttachments.length > 0
      ? [...attachments, ...newAttachments]
      : attachments
  }, [attachments, currentStatuses])

  const hasMedia = mediaAttachments.length > 0

  const hasLoadedMedia =
    attachments.length > 0 ||
    currentStatuses.some(
      (s) => s.type === StatusType.enum.Note && s.attachments.length > 0
    )

  const availableTabs = useMemo(() => {
    const tabs: ProfileTab[] = ['posts']
    if (showRepliesTab) {
      tabs.push('replies')
    }
    if (hasMedia) {
      tabs.push('media')
    }
    if (showGalleryTab) {
      tabs.push('gallery')
    }
    if (showFitnessTab) {
      tabs.push('fitness')
    }
    return tabs
  }, [showRepliesTab, hasMedia, showGalleryTab, showFitnessTab])

  // Warm the gallery panels at idle once a tab can show them, so switching to
  // it renders at once instead of waiting out the Suspense reveal throttle.
  const hasGalleryPanelTab = hasMedia || showGalleryTab
  useEffect(() => {
    if (!hasGalleryPanelTab) return
    return runWhenIdle(preloadGalleryPanels)
  }, [hasGalleryPanelTab])

  const [activeTab, setActiveTab] = useState<ProfileTab>(
    isMediaOnly ? 'media' : 'posts'
  )

  const effectiveActiveTab = useMemo(() => {
    if (availableTabs.includes(activeTab)) {
      return activeTab
    }
    return 'posts'
  }, [availableTabs, activeTab])

  const postStatuses = useMemo(
    () => currentStatuses.filter((status) => !isReply(status)),
    [currentStatuses]
  )
  const replyStatuses = useMemo(
    () => currentStatuses.filter((status) => isReply(status)),
    [currentStatuses]
  )
  const fitnessStatuses = useMemo(
    () => currentStatuses.filter((status) => hasFitnessFile(status)),
    [currentStatuses]
  )

  // The status cursor (outbox page or `max_id`) feeds the post/reply/fitness
  // feeds (all derived from the loaded status list), so the standalone load
  // more control is offered on those tabs. For media-only profiles, the media
  // grid is the status feed, so it also paginates via this cursor.
  const canLoadMore =
    Boolean(
      currentStatusPagination.nextPageUrl ||
      currentStatusPagination.nextMaxStatusId
    ) &&
    (isMediaOnly
      ? activeTab === 'media'
      : effectiveActiveTab === 'posts' ||
        (showRepliesTab && effectiveActiveTab === 'replies') ||
        (showFitnessTab && effectiveActiveTab === 'fitness'))

  const handleStatusCreated = useCallback(
    (status: Status) => {
      // A reply or quote of another actor's post is the viewer's own status and
      // does not belong in that actor's feed. On the viewer's own profile,
      // though, the new status is theirs — surface it right away instead of
      // waiting for a reload.
      if (isCurrentUser) {
        setCurrentStatuses((previousStatuses) => [status, ...previousStatuses])
      }
    },
    [isCurrentUser]
  )

  const handlePostUpdated = useCallback((updatedStatus: Status) => {
    // Announce-aware (like handlePostDeleted): also refreshes a boost row whose
    // original was the edited post. An edited status is always a note/poll.
    setCurrentStatuses((previousStatuses) =>
      updateMatchingStatus(
        previousStatuses,
        updatedStatus.id,
        () => updatedStatus as StatusNote | StatusPoll
      )
    )
  }, [])

  // Read through a ref so `handlePostDeleted` keeps one identity (memoized post
  // rows would otherwise all re-render on every status change).
  const currentStatusesRef = useRef(currentStatuses)
  useLayoutEffect(() => {
    currentStatusesRef.current = currentStatuses
  }, [currentStatuses])

  const handlePostDeleted = useCallback((status: Status) => {
    const remainingStatuses = removeOriginalStatus(
      currentStatusesRef.current,
      status.id
    )
    setCurrentStatuses((previousStatuses) =>
      removeOriginalStatus(previousStatuses, status.id)
    )
    // The database ignores a `max_id` that matches no row, so a cursor on
    // the deleted post would restart paging from the newest page. Step back
    // to the last post still loaded instead.
    setCurrentStatusPagination((previous) =>
      previous.nextMaxStatusId === status.id
        ? {
            ...previous,
            nextMaxStatusId: remainingStatuses.at(-1)?.id ?? null
          }
        : previous
    )
  }, [])

  const handleLikeChanged = useCallback(
    (status: StatusNote | StatusPoll, isLiked: boolean) => {
      setCurrentStatuses((previousStatuses) =>
        updateMatchingStatus(previousStatuses, status.id, (target) => ({
          ...target,
          isActorLiked: isLiked,
          totalLikes: isLiked
            ? target.totalLikes + 1
            : Math.max(0, target.totalLikes - 1)
        }))
      )
    },
    []
  )

  const handleBookmarkChanged = useCallback(
    (status: StatusNote | StatusPoll, isBookmarked: boolean) => {
      setCurrentStatuses((previousStatuses) =>
        updateMatchingStatus(previousStatuses, status.id, (target) => ({
          ...target,
          isActorBookmarked: isBookmarked
        }))
      )
    },
    []
  )

  // Reactions have to be synced alongside likes and bookmarks: those handlers
  // replace the status object in this page's own copy, which re-renders the
  // reaction row from its (now stale) `reactions` prop and would otherwise
  // revert a chip the viewer just added.
  const handleReactionsChanged = useCallback(
    (status: StatusNote | StatusPoll, reactions: StatusReaction[]) => {
      setCurrentStatuses((previousStatuses) =>
        updateMatchingStatus(previousStatuses, status.id, (target) => ({
          ...target,
          reactions
        }))
      )
    },
    []
  )

  const loadMoreStatuses = useCallback(async () => {
    const { nextPageUrl, nextMaxStatusId } = currentStatusPagination
    if (isLoadingRef.current || (!nextPageUrl && !nextMaxStatusId)) return

    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    setLoadMoreError(null)
    try {
      if (nextMaxStatusId) {
        const result = await getAccountStatusesPage({
          actorId,
          maxStatusId: nextMaxStatusId
        })
        setCurrentStatusPagination((previous) => ({
          ...previous,
          // A cursor that did not move would fetch the same page forever.
          nextMaxStatusId:
            result.nextMaxStatusId === nextMaxStatusId
              ? null
              : result.nextMaxStatusId
        }))
        if (result.statuses.length > 0) {
          setCurrentStatuses((previousStatuses) =>
            appendUniqueStatuses(previousStatuses, result.statuses)
          )
        }
        return
      }

      let pageUrl: string | null = nextPageUrl
      let prevPageUrl: string | null = currentStatusPagination.prevPageUrl
      let nextStatuses: Status[] = []
      const visitedPageUrls = new Set<string>()

      for (
        let loadedPages = 0;
        pageUrl && loadedPages < LOAD_MORE_PAGE_LIMIT;
        loadedPages += 1
      ) {
        if (visitedPageUrls.has(pageUrl)) {
          pageUrl = null
          break
        }
        visitedPageUrls.add(pageUrl)
        const result = await getActorStatuses({
          actorId,
          pageUrl
        })

        pageUrl =
          result.nextPageUrl && !visitedPageUrls.has(result.nextPageUrl)
            ? result.nextPageUrl
            : null
        prevPageUrl = result.prevPageUrl
        if (result.statuses.length > 0) {
          nextStatuses = result.statuses
          break
        }
      }

      const isCompletelyEmpty =
        nextStatuses.length === 0 &&
        currentStatuses.length === 0 &&
        mediaAttachments.length === 0

      if (
        nextStatuses.length === 0 &&
        (currentStatuses.length > 0 || mediaAttachments.length > 0)
      ) {
        setRequireManualLoadMore(true)
      } else {
        setRequireManualLoadMore(false)
      }

      setCurrentStatusPagination((previous) => ({
        ...previous,
        nextPageUrl: isCompletelyEmpty ? null : pageUrl,
        prevPageUrl
      }))
      if (nextStatuses.length > 0) {
        setCurrentStatuses((previousStatuses) =>
          appendUniqueStatuses(previousStatuses, nextStatuses)
        )
      }
    } catch (_error) {
      setLoadMoreError('Failed to load more posts')
    } finally {
      isLoadingRef.current = false
      setLoadingMoreStatuses(false)
    }
  }, [
    actorId,
    currentStatusPagination,
    currentStatuses.length,
    mediaAttachments.length
  ])

  const handleManualLoadMore = useCallback(() => {
    setRequireManualLoadMore(false)
    loadMoreStatuses()
  }, [loadMoreStatuses])

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current
    if (!loadMoreElement) return
    if (typeof IntersectionObserver === 'undefined') return
    if (loadMoreError) return
    if (requireManualLoadMore) return
    // Don't auto-trigger infinite scroll on an empty feed — let the user click "Load more"
    if (currentStatuses.length === 0 && mediaAttachments.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting) {
          loadMoreStatuses()
        }
      },
      {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
      }
    )

    observer.observe(loadMoreElement)
    return () => {
      observer.disconnect()
    }
  }, [
    loadMoreStatuses,
    canLoadMore,
    loadMoreError,
    requireManualLoadMore,
    currentStatuses.length,
    mediaAttachments.length
  ])

  const renderFeed = (
    feedStatuses: Status[],
    empty: { icon: LucideIcon; title: string; hint: string },
    prioritizeFirstMedia = false
  ) =>
    feedStatuses.length > 0 ? (
      <Posts
        host={host}
        currentTime={currentTime}
        statuses={feedStatuses}
        prioritizeFirstMedia={prioritizeFirstMedia}
        currentActor={currentActor}
        showActions={showActions}
        showReadOnlyStats={!showActions}
        isMediaUploadEnabled={isMediaUploadEnabled}
        postLineLimit={postLineLimit}
        onStatusCreated={handleStatusCreated}
        onPostUpdated={handlePostUpdated}
        onPostDeleted={handlePostDeleted}
        onLikeChanged={handleLikeChanged}
        onBookmarkChanged={handleBookmarkChanged}
        onReactionsChanged={handleReactionsChanged}
      />
    ) : (
      <EmptyState icon={empty.icon} title={empty.title}>
        {empty.hint}
      </EmptyState>
    )

  const noPosts = {
    icon: FileText,
    title: 'No posts yet',
    hint: isCurrentUser
      ? 'Posts you write show up here.'
      : 'Posts show up here once they write something.'
  }
  const noReplies = {
    icon: MessageCircle,
    title: 'No replies yet',
    hint: isCurrentUser
      ? 'Your replies to other people show up here.'
      : 'Replies to other people show up here.'
  }
  const noFitness = {
    icon: Activity,
    title: 'No fitness activities yet',
    hint: 'Activities shared as posts show up here.'
  }

  // Posts, replies and fitness page through the outbox cursor with Load more;
  // a failed page says so above the button, which is also the way to retry.
  const loadMoreControl = canLoadMore ? (
    <>
      {loadMoreError ? (
        <Alert title={loadMoreError}>Please try again.</Alert>
      ) : null}
      <LoadMoreButton
        containerRef={loadMoreRef}
        isLoading={isLoadingMoreStatuses}
        onClick={handleManualLoadMore}
      />
    </>
  ) : null

  if (isMediaOnly) {
    return (
      <div className="space-y-4">
        {hasLoadedMedia ? (
          <ActorMediaGallery
            actorId={actorId}
            initialAttachments={attachments}
            statuses={currentStatuses}
            isPixelfed={isPixelfed}
            isMediaOnly={isMediaOnly}
          />
        ) : (
          <EmptyState icon={Images} title="No media yet">
            Photos and videos show up here.
          </EmptyState>
        )}

        {loadMoreControl}
      </div>
    )
  }

  if (availableTabs.length <= 1) {
    return (
      <div className="space-y-4">
        {renderFeed(postStatuses, noPosts, !hasHeaderImage)}

        {loadMoreControl}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div onPointerEnter={preloadGalleryPanels} onFocus={preloadGalleryPanels}>
        <SegmentedControl
          aria-label="Profile sections"
          items={availableTabs.map((value) => ({
            value,
            label: PROFILE_TAB_LABELS[value]
          }))}
          value={effectiveActiveTab}
          onValueChange={(value) => setActiveTab(value as ProfileTab)}
          className="sm:w-fit"
        />
      </div>

      {effectiveActiveTab === 'posts' &&
        renderFeed(postStatuses, noPosts, !hasHeaderImage)}

      {effectiveActiveTab === 'replies' &&
        showRepliesTab &&
        renderFeed(replyStatuses, noReplies)}

      {effectiveActiveTab === 'media' && hasMedia && (
        <ActorMediaGallery
          actorId={actorId}
          initialAttachments={mediaAttachments}
          statuses={currentStatuses}
          isPixelfed={false}
        />
      )}

      {effectiveActiveTab === 'gallery' && showGalleryTab && (
        <ProfileGalleryTab
          actorId={actorId}
          handle={handle}
          subviews={gallerySubviews}
          isCurrentUser={isCurrentUser}
          mapProvider={mapProvider}
        />
      )}

      {effectiveActiveTab === 'fitness' && showFitnessTab && (
        <div className="space-y-4">
          {isCurrentUser && (
            <div className="flex justify-end">
              <Button variant="outline" asChild>
                <Link href="/fitness">
                  <Activity className="size-4" aria-hidden="true" />
                  Fitness dashboard
                </Link>
              </Button>
            </div>
          )}
          {renderFeed(fitnessStatuses, noFitness)}
        </div>
      )}

      {loadMoreControl}
    </div>
  )
}
