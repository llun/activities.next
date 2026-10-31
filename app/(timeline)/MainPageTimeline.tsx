'use client'

import { Home } from 'lucide-react'
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

import { getTimeline } from '@/lib/client'
import {
  getConnectionSnapshot,
  onConnectionRestored,
  reportRequestFailure
} from '@/lib/client/connection'
import {
  HydratedTimelineSegment,
  ScrollAnchorState,
  appendOlderPageToSegments,
  clearAllOfflineData,
  getOfflineTimeline,
  mergeFreshPageIntoSegments,
  mergeGapPageIntoSegments,
  reconcileSegmentsWithServerBatch,
  saveOfflineScrollAnchor,
  saveOfflineTimeline
} from '@/lib/client/offline'
import { reconcileCachedStatuses } from '@/lib/client/statuses'
import { TimelineRequestError } from '@/lib/client/timelines'
import { AnnouncementIconButton } from '@/lib/components/announcements/AnnouncementBanner'
import { useAnnouncements } from '@/lib/components/announcements/useAnnouncements'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { PageHeader } from '@/lib/components/page-header'
import { PostBox } from '@/lib/components/post-box/post-box'
import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import {
  MOBILE_FEED_SURFACE_CLASS,
  POST_LIST_FRAME_CLASS
} from '@/lib/components/posts/feedLayout'
import { ReplyToast } from '@/lib/components/posts/reply-toast'
import {
  reconcileStatusesMetadata,
  removeOriginalStatus,
  updateMatchingStatus
} from '@/lib/components/posts/statusArray'
import { TimelineFeed } from '@/lib/components/posts/timeline-feed'
import { getStatusReplyTargetId } from '@/lib/components/posts/timelineModel'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { useOpenStatusPath } from '@/lib/components/posts/useOpenStatusPath'
import { RefreshButton } from '@/lib/components/refresh-button'
import { scrollPageToTop } from '@/lib/components/scroll-to-top-button/scrollPageToTop'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Button } from '@/lib/components/ui/button'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { Timeline } from '@/lib/services/timelines/types'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { PostBoxAttachment } from '@/lib/types/domain/attachment'
import {
  Status,
  StatusNote,
  StatusPoll,
  getOriginalStatus
} from '@/lib/types/domain/status'
import {
  TimelineContext,
  TimelineParentPreview
} from '@/lib/types/domain/timeline'
import { StatusReaction } from '@/lib/types/mastodon/statusReaction'
import { cn } from '@/lib/utils'
import { getStatusDetailPathClient } from '@/lib/utils/getStatusDetailPathClient'

import {
  NewPostsPill,
  TimelineScrollToTopButton,
  VIEW_TOP_EDGE,
  createUnseenAboveStore
} from './NewPostsPill'

export const POLL_PAGE_LIMIT = 20

export type CompatibleTimelineContext =
  | TimelineContext
  | {
      ancestors?: Record<string, TimelineParentPreview>
      ancestorsById?: Record<string, TimelineParentPreview>
    }

export interface MainPageTimelineProps {
  host: string
  profile: ActorProfile
  currentTime: number
  isMediaUploadEnabled: boolean
  /** Photos the top composer opens with (`/?media=`), already validated. */
  initialMedia?: PostBoxAttachment[]
  statuses: Status[]
  timelineContext?: CompatibleTimelineContext
  initialNextMaxStatusId?: string | null
  postLineLimit?: PostLineLimit
  readingGroupBoosts?: boolean
  initialSegments?: HydratedTimelineSegment[]
  initialScrollAnchor?: ScrollAnchorState | null
  initialLastRefreshedAt?: number | null
  refreshOnMount?: boolean
  onUnauthorized?: () => void
}

const formatLastUpdated = (timestamp: number, current: number): string => {
  const diffSec = Math.max(0, Math.floor((current - timestamp) / 1000))
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

const isUnauthorizedError = (error: unknown): boolean => {
  if (
    typeof TimelineRequestError !== 'undefined' &&
    error instanceof TimelineRequestError
  ) {
    return error.isUnauthorized
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    ((error as { status?: number }).status === 401 ||
      (error as { status?: number }).status === 403)
  ) {
    return true
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'isUnauthorized' in error &&
    Boolean((error as { isUnauthorized?: boolean }).isUnauthorized)
  ) {
    return true
  }
  return false
}

const findStatusElement = (statusId: string): HTMLElement | null => {
  if (typeof document === 'undefined') return null
  const elements = document.querySelectorAll<HTMLElement>('[data-status-id]')
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    if (el.getAttribute('data-status-id') === statusId) {
      return el
    }
  }
  const rows = document.querySelectorAll<HTMLElement>('[data-row-status-ids]')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const ids = (row.getAttribute('data-row-status-ids') ?? '').split(' ')
    if (ids.includes(statusId)) {
      return row
    }
  }
  return null
}

const isTopOfFeedAnchor = (
  anchor: ScrollAnchorState | null | undefined,
  firstStatusId: string | undefined
): boolean => {
  if (!anchor || !anchor.statusId) return true
  return Boolean(
    firstStatusId &&
    anchor.statusId === firstStatusId &&
    anchor.offsetTop > VIEW_TOP_EDGE
  )
}

export const MainPageTimeline: FC<MainPageTimelineProps> = ({
  host,
  profile,
  currentTime,
  isMediaUploadEnabled,
  initialMedia,
  statuses,
  timelineContext,
  initialNextMaxStatusId = null,
  postLineLimit,
  readingGroupBoosts,
  initialSegments,
  initialScrollAnchor = null,
  initialLastRefreshedAt = null,
  refreshOnMount = false,
  onUnauthorized
}) => {
  const openStatusPath = useOpenStatusPath()
  // One announcements state for every copy the header renders (desktop box and
  // mobile bar), so there is one fetch, one timer and one open state.
  const announcements = useAnnouncements()

  const [segments, setSegments] = useState<HydratedTimelineSegment[]>(() => {
    if (initialSegments && initialSegments.length > 0) {
      return initialSegments
    }
    if (statuses && statuses.length > 0) {
      return [
        {
          statuses,
          nextMaxStatusId: initialNextMaxStatusId ?? null,
          prevMinStatusId: statuses[0]?.id ?? null
        }
      ]
    }
    return []
  })
  const segmentsRef = useRef<HydratedTimelineSegment[]>(segments)
  segmentsRef.current = segments

  const currentStatuses = useMemo(
    () => segments.flatMap((s) => s.statuses),
    [segments]
  )
  const currentStatusesRef = useRef<Status[]>(currentStatuses)
  currentStatusesRef.current = currentStatuses

  const normalizedTimelineContext = useMemo((): TimelineContext | undefined => {
    if (!timelineContext) return undefined
    if ('ancestorsById' in timelineContext && timelineContext.ancestorsById) {
      return { ancestorsById: timelineContext.ancestorsById }
    }
    if ('ancestors' in timelineContext && timelineContext.ancestors) {
      return { ancestorsById: timelineContext.ancestors }
    }
    return { ancestorsById: {} }
  }, [timelineContext])

  const [currentTimelineContext, setCurrentTimelineContext] = useState<
    TimelineContext | undefined
  >(normalizedTimelineContext)

  const [replyToastStatus, setReplyToastStatus] = useState<Status | null>(null)
  const [hasMoreStatuses, setHasMoreStatuses] = useState<boolean>(() => {
    if (initialSegments && initialSegments.length > 0) {
      return Boolean(
        initialSegments[initialSegments.length - 1]?.nextMaxStatusId
      )
    }
    return statuses.length > 0 || Boolean(initialNextMaxStatusId)
  })
  const [isLoadingMoreStatuses, setLoadingMoreStatuses] =
    useState<boolean>(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [newerPostsCount, setNewerPostsCount] = useState<number>(0)
  const [hasMoreNewerPosts, setHasMoreNewerPosts] = useState<boolean>(false)
  // Posts loaded above the reading spot that the reader has not scrolled to
  // yet. They count towards the "new posts" pill with the polled posts that
  // are not loaded at all.
  const [unseenAbove] = useState(createUnseenAboveStore)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(() =>
    Boolean(
      refreshOnMount &&
      statuses.length === 0 &&
      (!initialSegments || initialSegments.length === 0)
    )
  )
  const [loadingGapSegmentIndex, setLoadingGapSegmentIndex] = useState<
    number | null
  >(null)

  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(
    initialLastRefreshedAt
  )
  const [pendingScrollAnchor, setPendingScrollAnchor] =
    useState<ScrollAnchorState | null>(() => {
      const initialFirstStatusId = (
        initialSegments && initialSegments.length > 0
          ? initialSegments[0]?.statuses
          : statuses
      )?.[0]?.id
      return isTopOfFeedAnchor(initialScrollAnchor, initialFirstStatusId)
        ? null
        : initialScrollAnchor
    })
  const currentScrollAnchorRef = useRef<ScrollAnchorState | null>(
    pendingScrollAnchor
  )
  const [isScrolledDown, setIsScrolledDown] = useState<boolean>(() =>
    Boolean(pendingScrollAnchor)
  )
  const [hydratedActorId, setHydratedActorId] = useState<string | null>(() =>
    initialSegments && initialSegments.length > 0 ? profile.id : null
  )
  const connection = useConnectionStatus()

  const isLoadingRef = useRef<boolean>(false)
  const isPollingRef = useRef<boolean>(false)
  const lastFailedFetchRef = useRef<(() => Promise<void>) | null>(null)
  const lastStatusIdRef = useRef<string | null>(
    initialNextMaxStatusId ||
      (statuses.length > 0 ? statuses[statuses.length - 1].id : null)
  )
  const activeProfileIdRef = useRef<string>(profile.id)
  activeProfileIdRef.current = profile.id
  const segmentsActorIdRef = useRef<string>(profile.id)
  const hydratedOnceForActorRef = useRef<string | null>(
    initialSegments && initialSegments.length > 0 ? profile.id : null
  )
  const lastReconciledAtRef = useRef<number>(0)
  const restoredAnchorRef = useRef<string | null>(null)
  const scrollAnchorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const scrollingToTopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )
  const isScrollingToTopRef = useRef<boolean>(false)
  const lastJumpScrollYRef = useRef<number>(0)
  const scrollResetRevisionRef = useRef<number>(0)

  const clearScrollingToTop = useCallback(() => {
    isScrollingToTopRef.current = false
    if (scrollingToTopTimeoutRef.current) {
      clearTimeout(scrollingToTopTimeoutRef.current)
      scrollingToTopTimeoutRef.current = null
    }
  }, [])

  const gapAfterStatusIds = useMemo(() => {
    const map: Record<string, number> = {}
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      if (seg.statuses.length > 0 && seg.nextMaxStatusId !== null) {
        const lastStatus = seg.statuses[seg.statuses.length - 1]
        map[lastStatus.id] = i
      }
    }
    return map
  }, [segments])

  useEffect(() => {
    if (segments.length > 0) {
      const last = segments[segments.length - 1]
      setHasMoreStatuses(Boolean(last.nextMaxStatusId))
      if (last.nextMaxStatusId) {
        lastStatusIdRef.current = last.nextMaxStatusId
      }
    }
  }, [segments])

  // Gently reconcile attachment metadata if the statuses prop delivers
  // updated classifications (e.g. after navigating back from detail view,
  // revalidation, or prop update), preserving loaded pages, order, scroll,
  // user interactions, and local state.
  useEffect(() => {
    if (!statuses || statuses.length === 0) return

    setSegments((prev) =>
      prev.map((seg) => ({
        ...seg,
        statuses: reconcileStatusesMetadata(seg.statuses, statuses)
      }))
    )
  }, [statuses])

  useEffect(() => {
    if (normalizedTimelineContext) {
      setCurrentTimelineContext(normalizedTimelineContext)
    }
  }, [normalizedTimelineContext])

  // Set scroll restoration to manual so we control exact anchor preservation
  useEffect(() => {
    if (typeof window !== 'undefined' && window.history) {
      try {
        window.history.scrollRestoration = 'manual'
      } catch {
        // safe ignore
      }
    }
  }, [])

  // Adds every status in `nextSegments` that `previousStatuses` did not have.
  // Whether each one is above the reader is settled by the recount below,
  // once the merged list has rendered and the scroll anchor is restored.
  const markNewAsUnseen = useCallback(
    (previousStatuses: Status[], nextSegments: HydratedTimelineSegment[]) => {
      const previousIds = new Set(previousStatuses.map((status) => status.id))
      unseenAbove.add(
        nextSegments.flatMap((segment) =>
          segment.statuses
            .map((status) => status.id)
            .filter((id) => !previousIds.has(id))
        )
      )
    },
    [unseenAbove]
  )

  // IndexedDB Hydration on mount for profile.id
  useEffect(() => {
    if (initialSegments && initialSegments.length > 0) {
      hydratedOnceForActorRef.current = profile.id
      setHydratedActorId(profile.id)
      return
    }
    if (hydratedOnceForActorRef.current === profile.id) {
      return
    }
    let isCancelled = false
    const hydrateFromOffline = async () => {
      try {
        const cached = await getOfflineTimeline({
          actorId: profile.id,
          timeline: 'home'
        })
        if (isCancelled || activeProfileIdRef.current !== profile.id) return

        if (cached && cached.segments && cached.segments.length > 0) {
          const cachedCount = cached.statuses.length
          const merged =
            statuses.length > 0
              ? mergeFreshPageIntoSegments({
                  currentSegments: cached.segments,
                  incomingStatuses: statuses,
                  incomingNextMaxStatusId: initialNextMaxStatusId ?? null,
                  incomingPrevMinStatusId: statuses[0]?.id ?? null
                })
              : null
          const nextSegments = merged ? merged.segments : cached.segments
          const cachedFirstId =
            cached.statuses[0]?.id ?? cached.segments[0]?.statuses[0]?.id
          const firstId = nextSegments[0]?.statuses[0]?.id
          const validAnchor =
            isTopOfFeedAnchor(cached.scrollAnchor, cachedFirstId) ||
            isTopOfFeedAnchor(cached.scrollAnchor, firstId)
              ? null
              : (cached.scrollAnchor ?? null)

          if (
            cachedCount > statuses.length ||
            (cached.segments.length > 1 && cachedCount > 0) ||
            (cachedCount > 0 && validAnchor !== null)
          ) {
            if (statuses.length > 0 && validAnchor !== null) {
              // The saved reading spot comes back below the fresher first
              // page, so those posts are new to the reader.
              markNewAsUnseen(cached.statuses, nextSegments)
            }
            segmentsActorIdRef.current = profile.id
            setSegments(nextSegments)
            if (cached.ancestorsById) {
              setCurrentTimelineContext((prev) => ({
                ancestorsById: {
                  ...(cached.ancestorsById || {}),
                  ...(prev?.ancestorsById || {})
                }
              }))
            }
            if (cached.lastRefreshedAt) {
              setLastRefreshedAt(cached.lastRefreshedAt)
            }
            if (validAnchor) {
              restoredAnchorRef.current = null
              currentScrollAnchorRef.current = validAnchor
              setPendingScrollAnchor(validAnchor)
              setIsScrolledDown(true)
            }
          }
        }
      } catch {
        // offline read errors are silently ignored
      } finally {
        if (!isCancelled && activeProfileIdRef.current === profile.id) {
          hydratedOnceForActorRef.current = profile.id
          setHydratedActorId(profile.id)
        }
      }
    }
    void hydrateFromOffline()
    return () => {
      isCancelled = true
    }
  }, [
    profile.id,
    initialSegments,
    statuses,
    initialNextMaxStatusId,
    markNewAsUnseen
  ])

  // Offline persistence whenever segments or context change
  useEffect(() => {
    if (segments.length === 0) return
    if (segmentsActorIdRef.current !== profile.id) return
    if (hydratedActorId !== profile.id) return
    const actorId = profile.id
    void saveOfflineTimeline({
      actorId,
      timeline: 'home',
      segments,
      ancestorsById: currentTimelineContext?.ancestorsById ?? {},
      lastRefreshedAt: lastRefreshedAt ?? Date.now(),
      scrollAnchor: currentScrollAnchorRef.current
    })
  }, [
    profile.id,
    hydratedActorId,
    segments,
    currentTimelineContext,
    lastRefreshedAt
  ])

  // Scroll anchor restoration
  useLayoutEffect(() => {
    if (!pendingScrollAnchor || !pendingScrollAnchor.statusId) return
    if (restoredAnchorRef.current === pendingScrollAnchor.statusId) return

    const el = findStatusElement(pendingScrollAnchor.statusId)
    if (el) {
      const rect = el.getBoundingClientRect()
      const diff = rect.top - pendingScrollAnchor.offsetTop
      if (Math.abs(diff) > 2) {
        window.scrollBy({ top: diff, behavior: 'instant' as ScrollBehavior })
      }
      restoredAnchorRef.current = pendingScrollAnchor.statusId
      setIsScrolledDown(true)
      unseenAbove.recount()
    }
  }, [pendingScrollAnchor, segments, unseenAbove])

  // Scroll anchor tracking
  useEffect(() => {
    if (typeof window === 'undefined') return

    const recordScrollAnchor = () => {
      if (isScrollingToTopRef.current) {
        if (
          window.scrollY <= VIEW_TOP_EDGE ||
          window.scrollY > lastJumpScrollYRef.current
        ) {
          clearScrollingToTop()
        } else {
          lastJumpScrollYRef.current = window.scrollY
          return
        }
      }
      const actorId = activeProfileIdRef.current
      const elements =
        document.querySelectorAll<HTMLElement>('[data-status-id]')
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        const rect = el.getBoundingClientRect()
        if (rect.bottom > VIEW_TOP_EDGE) {
          if (i === 0 && rect.top > VIEW_TOP_EDGE) {
            currentScrollAnchorRef.current = null
            void saveOfflineScrollAnchor({
              actorId,
              timeline: 'home',
              scrollAnchor: null
            })
            break
          }
          const statusId = el.getAttribute('data-status-id')
          if (statusId) {
            const anchor: ScrollAnchorState = {
              statusId,
              offsetTop: Math.round(rect.top),
              updatedAt: Date.now()
            }
            currentScrollAnchorRef.current = anchor
            void saveOfflineScrollAnchor({
              actorId,
              timeline: 'home',
              scrollAnchor: anchor
            })
          }
          break
        }
      }
    }

    const cancelSmoothScrollToTop = () => {
      clearScrollingToTop()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) {
        clearScrollingToTop()
      }
    }

    const handleScroll = () => {
      if (isScrollingToTopRef.current) {
        if (
          window.scrollY <= VIEW_TOP_EDGE ||
          window.scrollY > lastJumpScrollYRef.current
        ) {
          clearScrollingToTop()
        } else {
          lastJumpScrollYRef.current = window.scrollY
          return
        }
      }
      if (scrollAnchorTimeoutRef.current) return
      scrollAnchorTimeoutRef.current = setTimeout(() => {
        scrollAnchorTimeoutRef.current = null
        recordScrollAnchor()
      }, 200)
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        recordScrollAnchor()
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('wheel', cancelSmoothScrollToTop, { passive: true })
    window.addEventListener('touchmove', cancelSmoothScrollToTop, {
      passive: true
    })
    window.addEventListener('pointerdown', cancelSmoothScrollToTop, {
      passive: true
    })
    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (scrollAnchorTimeoutRef.current) {
        clearTimeout(scrollAnchorTimeoutRef.current)
        scrollAnchorTimeoutRef.current = null
      }
      clearScrollingToTop()
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('wheel', cancelSmoothScrollToTop)
      window.removeEventListener('touchmove', cancelSmoothScrollToTop)
      window.removeEventListener('pointerdown', cancelSmoothScrollToTop)
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [clearScrollingToTop])

  // Recount whenever the list changes (once any pending anchor restore above
  // has put the reading spot back) and as the reader scrolls, so the pill
  // counts down while they read upwards.
  useEffect(() => {
    if (
      pendingScrollAnchor?.statusId &&
      restoredAnchorRef.current !== pendingScrollAnchor.statusId
    ) {
      return
    }
    unseenAbove.recount()
  }, [currentStatuses, pendingScrollAnchor, unseenAbove])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let frame: number | null = null
    const handleScroll = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => {
        frame = null
        unseenAbove.recount()
        if (isScrollingToTopRef.current) {
          if (
            window.scrollY <= VIEW_TOP_EDGE ||
            window.scrollY > lastJumpScrollYRef.current
          ) {
            clearScrollingToTop()
          } else {
            setIsScrolledDown(false)
            return
          }
        }
        const first =
          typeof document !== 'undefined'
            ? document.querySelector<HTMLElement>('[data-status-id]')
            : null
        const firstRect = first ? first.getBoundingClientRect() : null
        const scrolledPastTop =
          window.scrollY > VIEW_TOP_EDGE ||
          Boolean(
            firstRect &&
            firstRect.bottom > firstRect.top &&
            firstRect.bottom <= VIEW_TOP_EDGE
          )
        setIsScrolledDown(scrolledPastTop)
      })
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (frame !== null) window.cancelAnimationFrame(frame)
    }
  }, [clearScrollingToTop, unseenAbove])

  // A new post composed in the top box, or a quote created inline from a
  // feed row, is prepended so it appears immediately.
  const onStatusCreated = useCallback((status: Status) => {
    setSegments((prev) => {
      if (prev.length === 0) {
        return [
          {
            statuses: [status],
            nextMaxStatusId: null,
            prevMinStatusId: status.id
          }
        ]
      }
      return [
        {
          ...prev[0],
          statuses: [status, ...prev[0].statuses],
          prevMinStatusId: status.id
        },
        ...prev.slice(1)
      ]
    })
  }, [])

  // When a reply is created inline from a feed row, update the parent status's
  // reply count and insert the reply directly next to the replied message in the feed.
  const onReplyCreated = useCallback((reply: Status) => {
    const originalReply = getOriginalStatus(reply)
    const parentId =
      ('reply' in originalReply &&
      typeof originalReply.reply === 'string' &&
      originalReply.reply.trim()
        ? originalReply.reply.trim()
        : null) || getStatusReplyTargetId(originalReply)

    setSegments((prev) => {
      let inserted = false
      const updated = prev.map((seg) => {
        if (inserted) return seg

        const withUpdatedCount = updateMatchingStatus(
          seg.statuses,
          parentId || '',
          (target) => ({
            ...target,
            totalReplies: (target.totalReplies ?? 0) + 1,
            replies: target.replies ? [...target.replies, reply] : [reply]
          })
        )

        const parentIndex = withUpdatedCount.findIndex((s) => {
          if (s.id === parentId || s.publicId === parentId) return true
          const orig = getOriginalStatus(s)
          return (
            orig.id === parentId ||
            orig.url === parentId ||
            orig.publicId === parentId
          )
        })

        if (parentIndex !== -1) {
          inserted = true
          if (withUpdatedCount.some((s) => s.id === reply.id)) {
            return { ...seg, statuses: withUpdatedCount }
          }
          const next = [...withUpdatedCount]
          next.splice(parentIndex + 1, 0, reply)
          return { ...seg, statuses: next }
        }

        return { ...seg, statuses: withUpdatedCount }
      })

      if (!inserted) {
        if (updated.length === 0) {
          return [
            {
              statuses: [reply],
              nextMaxStatusId: null,
              prevMinStatusId: reply.id
            }
          ]
        }
        return [
          {
            ...updated[0],
            statuses: [reply, ...updated[0].statuses]
          },
          ...updated.slice(1)
        ]
      }
      return updated
    })

    setReplyToastStatus(reply)
  }, [])

  const onPostUpdated = useCallback((status: Status) => {
    // Announce-aware (like onPostDeleted): also refreshes a boost row whose
    // original was the edited post. An edited status is always a note/poll.
    setSegments((prev) =>
      prev.map((seg) => ({
        ...seg,
        statuses: updateMatchingStatus(
          seg.statuses,
          status.id,
          () => status as StatusNote | StatusPoll
        )
      }))
    )
  }, [])

  const onPostDeleted = useCallback((status: Status) => {
    setSegments((prev) =>
      prev.map((seg) => ({
        ...seg,
        statuses: removeOriginalStatus(seg.statuses, status.id)
      }))
    )
  }, [])

  const onLikeChanged = useCallback(
    (status: StatusNote | StatusPoll, isLiked: boolean) => {
      setSegments((prev) =>
        prev.map((seg) => ({
          ...seg,
          statuses: updateMatchingStatus(seg.statuses, status.id, (target) => ({
            ...target,
            isActorLiked: isLiked,
            totalLikes: isLiked
              ? target.totalLikes + 1
              : Math.max(0, target.totalLikes - 1)
          }))
        }))
      )
    },
    []
  )

  const onBookmarkChanged = useCallback(
    (status: StatusNote | StatusPoll, isBookmarked: boolean) => {
      setSegments((prev) =>
        prev.map((seg) => ({
          ...seg,
          statuses: updateMatchingStatus(seg.statuses, status.id, (target) => ({
            ...target,
            isActorBookmarked: isBookmarked
          }))
        }))
      )
    },
    []
  )

  const onReactionsChanged = useCallback(
    (status: StatusNote | StatusPoll, reactions: StatusReaction[]) => {
      setSegments((prev) =>
        prev.map((seg) => ({
          ...seg,
          statuses: updateMatchingStatus(seg.statuses, status.id, (target) => ({
            ...target,
            reactions
          }))
        }))
      )
    },
    []
  )

  const loadMoreStatuses = useCallback(async () => {
    const currentSegs = segmentsRef.current
    const lastSeg = currentSegs[currentSegs.length - 1]
    const lastStatusId =
      lastSeg?.nextMaxStatusId ??
      lastStatusIdRef.current ??
      (currentStatusesRef.current.length > 0
        ? currentStatusesRef.current[currentStatusesRef.current.length - 1].id
        : null)

    if (isLoadingRef.current || !lastStatusId) return

    isLoadingRef.current = true
    setLoadingMoreStatuses(true)
    setFetchError(null)
    try {
      const result = await getTimeline({
        timeline: Timeline.MAIN,
        maxStatusId: lastStatusId
      })
      const nextCursor = result.nextMaxStatusId ?? null
      lastStatusIdRef.current = nextCursor
      setHasMoreStatuses(Boolean(result.nextMaxStatusId))
      // Loading older posts means the reader is past any saved reading spot.
      restoredAnchorRef.current = null
      currentScrollAnchorRef.current = null
      setPendingScrollAnchor(null)

      setSegments((prev) => {
        const appended = appendOlderPageToSegments({
          currentSegments: prev,
          incomingStatuses: result.statuses,
          incomingNextMaxStatusId: result.nextMaxStatusId
        })
        return appended.segments
      })

      if (result.context?.ancestorsById) {
        setCurrentTimelineContext((prev) => ({
          ancestorsById: {
            ...(prev?.ancestorsById ?? {}),
            ...result.context?.ancestorsById
          }
        }))
      }
      lastFailedFetchRef.current = null
    } catch (error) {
      if (isUnauthorizedError(error)) {
        try {
          await clearAllOfflineData()
        } catch {
          // safe ignore
        }
        onUnauthorized?.()
        setFetchError('Session expired. Please sign in again.')
      } else {
        reportRequestFailure(error)
        setFetchError('Failed to load posts')
        lastFailedFetchRef.current = loadMoreStatuses
      }
    } finally {
      isLoadingRef.current = false
      setLoadingMoreStatuses(false)
    }
  }, [onUnauthorized])

  const { loadMoreRef, isLoadMoreVisible } = useLoadMoreOnVisible({
    enabled: hasMoreStatuses,
    onLoadMore: loadMoreStatuses
  })

  const refreshTimeline = useCallback(
    async (options?: { preserveScroll?: boolean }) => {
      // isLoadingRef serializes refreshes, so only one runs at a time and there
      // is no concurrent request to guard against.
      if (isLoadingRef.current) return

      isLoadingRef.current = true
      setIsRefreshing(true)
      setLoadingMoreStatuses(true)
      setFetchError(null)

      const isCurrentlyScrolledDown = () => {
        if (typeof window !== 'undefined' && window.scrollY > VIEW_TOP_EDGE) {
          return true
        }
        if (typeof document !== 'undefined') {
          const first = document.querySelector<HTMLElement>('[data-status-id]')
          if (first) {
            const firstRect = first.getBoundingClientRect()
            if (
              firstRect.bottom > firstRect.top &&
              firstRect.bottom <= VIEW_TOP_EDGE
            ) {
              return true
            }
          }
        }
        return false
      }

      const resetRevisionAtStart = scrollResetRevisionRef.current
      const previousFirstId = currentStatusesRef.current[0]?.id

      try {
        const result = await getTimeline({
          timeline: Timeline.MAIN
        })

        const resetWasTriggered =
          scrollResetRevisionRef.current !== resetRevisionAtStart
        const shouldPreserve = isScrollingToTopRef.current
          ? false
          : (options?.preserveScroll ?? isCurrentlyScrolledDown())
        const effectivePreserve = shouldPreserve && !resetWasTriggered

        let capturedAnchor: { statusId: string; offsetTop: number } | null =
          null
        if (effectivePreserve && typeof document !== 'undefined') {
          const elements =
            document.querySelectorAll<HTMLElement>('[data-status-id]')
          for (let i = 0; i < elements.length; i++) {
            const el = elements[i]
            const rect = el.getBoundingClientRect()
            if (rect.bottom > VIEW_TOP_EDGE) {
              const statusId = el.getAttribute('data-status-id')
              if (statusId) {
                capturedAnchor = {
                  statusId,
                  offsetTop: Math.round(rect.top)
                }
              }
              break
            }
          }
        }

        const merged = mergeFreshPageIntoSegments({
          currentSegments: segmentsRef.current,
          incomingStatuses: result.statuses,
          incomingNextMaxStatusId: result.nextMaxStatusId,
          incomingPrevMinStatusId: result.prevMinStatusId
        })
        const now = Date.now()
        const firstMergedId = merged.segments[0]?.statuses[0]?.id
        const hasNewerPrepended =
          Boolean(firstMergedId) && firstMergedId !== previousFirstId
        const isCapturedTopOfFeed =
          capturedAnchor !== null &&
          (isTopOfFeedAnchor(
            {
              statusId: capturedAnchor.statusId,
              offsetTop: capturedAnchor.offsetTop,
              updatedAt: now
            },
            previousFirstId
          ) ||
            isTopOfFeedAnchor(
              {
                statusId: capturedAnchor.statusId,
                offsetTop: capturedAnchor.offsetTop,
                updatedAt: now
              },
              firstMergedId
            ))
        const willPreserveAnchor =
          effectivePreserve && capturedAnchor !== null && !isCapturedTopOfFeed

        // A refresh that keeps the reading spot loads the newer posts above
        // the reader. One that goes to the top (the pill, a fresh load)
        // shows them on screen.
        if (willPreserveAnchor) {
          markNewAsUnseen(currentStatusesRef.current, merged.segments)
        }
        segmentsActorIdRef.current = profile.id
        setSegments(merged.segments)

        const lastSeg = merged.segments[merged.segments.length - 1]
        if (lastSeg) {
          setHasMoreStatuses(Boolean(lastSeg.nextMaxStatusId))
          lastStatusIdRef.current =
            lastSeg.nextMaxStatusId ||
            (lastSeg.statuses.length > 0
              ? lastSeg.statuses[lastSeg.statuses.length - 1].id
              : null)
        } else {
          setHasMoreStatuses(Boolean(result.nextMaxStatusId))
          lastStatusIdRef.current =
            result.nextMaxStatusId ||
            (result.statuses.length > 0
              ? result.statuses[result.statuses.length - 1].id
              : null)
        }

        if (result.context?.ancestorsById) {
          setCurrentTimelineContext((prev) => ({
            ancestorsById: {
              ...(prev?.ancestorsById ?? {}),
              ...result.context?.ancestorsById
            }
          }))
        }

        setLastRefreshedAt(now)
        setNewerPostsCount(0)
        setHasMoreNewerPosts(false)
        lastFailedFetchRef.current = null

        if (willPreserveAnchor && capturedAnchor) {
          restoredAnchorRef.current = null
          const nextAnchor: ScrollAnchorState = {
            statusId: capturedAnchor.statusId,
            offsetTop: hasNewerPrepended
              ? Math.min(capturedAnchor.offsetTop, VIEW_TOP_EDGE)
              : capturedAnchor.offsetTop,
            updatedAt: now
          }
          currentScrollAnchorRef.current = nextAnchor
          setPendingScrollAnchor(nextAnchor)
        } else if (!effectivePreserve || isCapturedTopOfFeed) {
          restoredAnchorRef.current = null
          currentScrollAnchorRef.current = null
          setPendingScrollAnchor(null)
          if (
            !effectivePreserve ||
            typeof window === 'undefined' ||
            window.scrollY <= VIEW_TOP_EDGE
          ) {
            setIsScrolledDown(false)
          }
        }

        // Trigger background batch revalidation of up to 80 cached status.ids outside
        // the newly fetched top page (throttled to at most once every 5 minutes per mount)
        if (now - lastReconciledAtRef.current > 5 * 60 * 1000) {
          lastReconciledAtRef.current = now
          const fetchedIds = new Set(result.statuses.map((s) => s.id))
          const cachedIdsOutsideTop: string[] = []
          for (const seg of merged.segments) {
            for (const st of seg.statuses) {
              if (!fetchedIds.has(st.id)) {
                cachedIdsOutsideTop.push(st.id)
              }
            }
          }

          if (cachedIdsOutsideTop.length > 0) {
            const batchToReconcile = cachedIdsOutsideTop.slice(0, 80)
            void (async () => {
              try {
                const reconcileResult = await reconcileCachedStatuses({
                  statusIds: batchToReconcile
                })
                if (
                  reconcileResult.removedStatusIds.length > 0 ||
                  reconcileResult.statuses.length > 0
                ) {
                  setSegments((currSegments) => {
                    const reconciled = reconcileSegmentsWithServerBatch({
                      currentSegments: currSegments,
                      updatedStatuses: reconcileResult.statuses,
                      removedStatusIds: reconcileResult.removedStatusIds
                    })
                    return reconciled.segments
                  })
                }
              } catch {
                // background reconciliation is best-effort
              }
            })()
          }
        }
      } catch (error) {
        if (isUnauthorizedError(error)) {
          try {
            await clearAllOfflineData()
          } catch {
            // safe ignore
          }
          onUnauthorized?.()
          setFetchError('Session expired. Please sign in again.')
        } else {
          reportRequestFailure(error)
          setFetchError('Failed to load posts')
          lastFailedFetchRef.current = () => refreshTimeline(options)
        }
      } finally {
        setLoadingMoreStatuses(false)
        isLoadingRef.current = false
        setIsRefreshing(false)
      }
    },
    [onUnauthorized, markNewAsUnseen, profile.id]
  )

  const handleLoadGap = useCallback(
    async (segmentIndex: number) => {
      const seg = segmentsRef.current[segmentIndex]
      if (!seg || !seg.nextMaxStatusId) return

      setLoadingGapSegmentIndex(segmentIndex)
      try {
        const result = await getTimeline({
          timeline: Timeline.MAIN,
          maxStatusId: seg.nextMaxStatusId
        })
        setSegments((prevSegments) => {
          const merged = mergeGapPageIntoSegments({
            currentSegments: prevSegments,
            segmentIndex,
            incomingStatuses: result.statuses,
            incomingNextMaxStatusId: result.nextMaxStatusId
          })
          return merged.segments
        })
        if (result.context?.ancestorsById) {
          setCurrentTimelineContext((prev) => ({
            ancestorsById: {
              ...(prev?.ancestorsById ?? {}),
              ...result.context?.ancestorsById
            }
          }))
        }
      } catch (error) {
        if (isUnauthorizedError(error)) {
          try {
            await clearAllOfflineData()
          } catch {
            // safe ignore
          }
          onUnauthorized?.()
          setFetchError('Session expired. Please sign in again.')
        } else {
          reportRequestFailure(error)
        }
      } finally {
        setLoadingGapSegmentIndex(null)
      }
    },
    [onUnauthorized]
  )

  const handleRetry = useCallback(() => {
    setFetchError(null)
    if (lastFailedFetchRef.current) {
      void lastFailedFetchRef.current()
    }
  }, [])

  const clearScrollAnchorAndJumpToTop = useCallback(() => {
    scrollResetRevisionRef.current += 1
    if (scrollAnchorTimeoutRef.current) {
      clearTimeout(scrollAnchorTimeoutRef.current)
      scrollAnchorTimeoutRef.current = null
    }
    unseenAbove.clear()
    restoredAnchorRef.current = null
    currentScrollAnchorRef.current = null
    setPendingScrollAnchor(null)
    setIsScrolledDown(false)
    void saveOfflineScrollAnchor({
      actorId: profile.id,
      timeline: 'home',
      scrollAnchor: null
    })
    const startScrollY = typeof window !== 'undefined' ? window.scrollY : 0
    lastJumpScrollYRef.current = startScrollY
    clearScrollingToTop()
    if (startScrollY > VIEW_TOP_EDGE) {
      isScrollingToTopRef.current = true
      scrollingToTopTimeoutRef.current = setTimeout(() => {
        isScrollingToTopRef.current = false
        scrollingToTopTimeoutRef.current = null
      }, 1000)
    }
    scrollPageToTop()
    if (typeof window !== 'undefined' && window.scrollY <= VIEW_TOP_EDGE) {
      clearScrollingToTop()
    }
  }, [clearScrollingToTop, profile.id, unseenAbove])

  const handleCleanTopSnapshot = useCallback(async () => {
    setNewerPostsCount(0)
    setHasMoreNewerPosts(false)
    clearScrollAnchorAndJumpToTop()
    await refreshTimeline({ preserveScroll: false })
  }, [clearScrollAnchorAndJumpToTop, refreshTimeline])

  // The pill counts both kinds of new posts, or offers "Back to top" when
  // scrolled down with none. Posts the poll found are not loaded yet, so they
  // need a refresh; posts already loaded above (or a plain jump) only need
  // the scroll to top.
  const handleNewPostsPill = useCallback(() => {
    if (newerPostsCount > 0) {
      void handleCleanTopSnapshot()
      return
    }
    clearScrollAnchorAndJumpToTop()
  }, [newerPostsCount, handleCleanTopSnapshot, clearScrollAnchorAndJumpToTop])

  // Auto-reconnect refresh: the connection store fires this once per
  // transition back to online.
  useEffect(
    () =>
      onConnectionRestored(
        () => void refreshTimeline({ preserveScroll: true })
      ),
    [refreshTimeline]
  )

  useEffect(() => {
    if (refreshOnMount) {
      void refreshTimeline({
        preserveScroll:
          currentScrollAnchorRef.current !== null ? true : undefined
      })
    }
  }, [refreshOnMount, refreshTimeline])

  useEffect(() => {
    const pollNewerPosts = async () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible'
      ) {
        return
      }
      if (
        isLoadingRef.current ||
        isPollingRef.current ||
        getConnectionSnapshot().state !== 'online'
      ) {
        return
      }

      const topStatus = currentStatusesRef.current[0]
      if (!topStatus) return

      isPollingRef.current = true
      try {
        const result = await getTimeline({
          timeline: Timeline.MAIN,
          minStatusId: topStatus.id,
          prevMinStatusId: topStatus.id,
          limit: POLL_PAGE_LIMIT
        })
        const currentIds = new Set(currentStatusesRef.current.map((s) => s.id))
        const statuses = result.statuses ?? []
        const freshNewCount = statuses.filter(
          (s) => !currentIds.has(s.id)
        ).length
        setNewerPostsCount(freshNewCount)
        setHasMoreNewerPosts(statuses.length >= POLL_PAGE_LIMIT)
      } catch (_error) {
        // Foreground polling failure is silent
      } finally {
        isPollingRef.current = false
      }
    }

    const interval = setInterval(() => {
      void pollNewerPosts()
    }, 15000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void pollNewerPosts()
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      clearInterval(interval)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [])

  const showsEmptyState =
    currentStatuses.length === 0 &&
    !isLoadingMoreStatuses &&
    !isRefreshing &&
    !fetchError

  return (
    <div className="space-y-6">
      <TimelineScrollToTopButton
        store={unseenAbove}
        polledCount={newerPostsCount}
        isScrolledDown={isScrolledDown}
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      <PageHeader
        // Below `md` Refresh sits at the end of the compact bar, which then
        // carries the whole header, so the borderless, full-bleed composer
        // meets the bar's hairline directly.
        flushOnMobile
        actionsInMobileBar
        // Tapping the title goes back to the newest post, as tapping a column
        // header does in Mastodon.
        title={
          <button
            type="button"
            onClick={clearScrollAnchorAndJumpToTop}
            title="Back to the newest post"
            className="cursor-pointer rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Timeline
          </button>
        }
        actions={
          <div className="flex items-center gap-2">
            <AnnouncementIconButton state={announcements} />
            <RefreshButton
              onRefresh={() => refreshTimeline()}
              refreshing={isRefreshing}
              accessibleName="Refresh timeline"
            />
          </div>
        }
        // The new-posts pill floats under the header and follows it on scroll.
        bottomSlot={
          <div className="flex justify-center">
            <NewPostsPill
              store={unseenAbove}
              polledCount={newerPostsCount}
              hasMorePolled={hasMoreNewerPosts}
              isScrolledDown={isScrolledDown}
              isRefreshing={isRefreshing}
              onJump={handleNewPostsPill}
            />
          </div>
        }
      />

      {connection.state !== 'online' && lastRefreshedAt ? (
        <p className="text-xs text-muted-foreground">
          Updated {formatLastUpdated(lastRefreshedAt, currentTime)}
        </p>
      ) : null}

      {/* The home timeline keeps a top composer for brand-new posts. Reply,
          quote, and edit happen inline in the feed via the shared composer,
          like every other surface. PostBox draws the card itself
          (`frameClassName`) so its failure Alert lands after the card, never
          inside it. */}
      <PostBox
        host={host}
        profile={profile}
        isMediaUploadEnabled={isMediaUploadEnabled}
        initialMedia={initialMedia}
        frameClassName={cn(
          POST_LIST_FRAME_CLASS,
          'p-4',
          MOBILE_FEED_SURFACE_CLASS
        )}
        showDraftsLink
        onDiscardReply={() => {}}
        onDiscardQuote={() => {}}
        onDiscardEdit={() => {}}
        onPostCreated={onStatusCreated}
        onPostUpdated={onPostUpdated}
      />

      <div
        aria-hidden="true"
        className="max-md:-mt-6 max-md:ml-[calc(50%_-_50vw)] max-md:h-px max-md:w-screen max-md:bg-border md:hidden"
      />

      {/* The section is pulled up (`-mt-6`) so a full-bleed feed meets the
          composer's divider. The empty panel is inset, not full-bleed, so it
          keeps the normal gap instead of sitting on the hairline (a margin on
          the panel itself would collapse into the section's). */}
      <section className={cn(!showsEmptyState && 'max-md:-mt-6')}>
        {currentStatuses.length > 0 ? (
          <TimelineFeed
            host={host}
            currentTime={currentTime}
            statuses={currentStatuses}
            timelineContext={currentTimelineContext}
            currentActor={profile}
            showActions
            readingGroupBoosts={readingGroupBoosts}
            isMediaUploadEnabled={isMediaUploadEnabled}
            postLineLimit={postLineLimit}
            onStatusCreated={onStatusCreated}
            onReplyCreated={onReplyCreated}
            onPostUpdated={onPostUpdated}
            onPostDeleted={onPostDeleted}
            onLikeChanged={onLikeChanged}
            onBookmarkChanged={onBookmarkChanged}
            onReactionsChanged={onReactionsChanged}
            gapAfterStatusIds={gapAfterStatusIds}
            loadingGapSegmentIndex={loadingGapSegmentIndex}
            onLoadGap={handleLoadGap}
          />
        ) : isLoadingMoreStatuses || isRefreshing ? (
          <div role="status">
            <span className="sr-only">Loading timeline</span>
            <PostListSkeleton />
          </div>
        ) : fetchError ? null : (
          <EmptyState
            icon={Home}
            titleAs="h2"
            title="Your timeline is empty"
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/explore">Find people to follow</Link>
              </Button>
            }
          >
            Follow some people to see their posts here.
          </EmptyState>
        )}
        {hasMoreStatuses && (
          <div
            ref={loadMoreRef}
            aria-hidden="true"
            className="h-px w-full pointer-events-none"
          />
        )}
      </section>

      {fetchError && (
        <Alert title={fetchError} onRetry={handleRetry}>
          {fetchError.includes('Session expired')
            ? 'Your session has expired. Please sign in again to continue.'
            : 'Check your connection and try again.'}
        </Alert>
      )}

      {hasMoreStatuses && (
        <LoadMoreButton
          containerRef={loadMoreRef}
          presentation="overlay"
          hasItems={currentStatuses.length > 0}
          isLoading={isLoadingMoreStatuses}
          onClick={loadMoreStatuses}
        />
      )}

      {replyToastStatus ? (
        <ReplyToast
          status={replyToastStatus}
          onDismiss={() => setReplyToastStatus(null)}
          onViewReply={(statusToView) => {
            void (async () => {
              const detailPath = await getStatusDetailPathClient(statusToView)
              if (detailPath) openStatusPath(detailPath)
            })()
          }}
        />
      ) : null}
    </div>
  )
}
