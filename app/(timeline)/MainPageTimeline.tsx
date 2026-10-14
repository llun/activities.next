'use client'

import { Home } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
import { RefreshButton } from '@/lib/components/refresh-button'
import { ScrollToTopButton } from '@/lib/components/scroll-to-top-button'
import { Alert } from '@/lib/components/surface/Alert'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { Button } from '@/lib/components/ui/button'
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
  const router = useRouter()
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
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)
  const [loadingGapSegmentIndex, setLoadingGapSegmentIndex] = useState<
    number | null
  >(null)

  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(
    initialLastRefreshedAt
  )
  const [pendingScrollAnchor, setPendingScrollAnchor] =
    useState<ScrollAnchorState | null>(initialScrollAnchor)
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  )

  const isLoadingRef = useRef<boolean>(false)
  const isPollingRef = useRef<boolean>(false)
  const lastFailedFetchRef = useRef<(() => Promise<void>) | null>(null)
  const lastStatusIdRef = useRef<string | null>(
    initialNextMaxStatusId ||
      (statuses.length > 0 ? statuses[statuses.length - 1].id : null)
  )
  const activeProfileIdRef = useRef<string>(profile.id)
  activeProfileIdRef.current = profile.id
  const lastReconciledAtRef = useRef<number>(0)
  const restoredAnchorRef = useRef<string | null>(null)

  const gapAfterStatusIds = useMemo(() => {
    const map: Record<string, number> = {}
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]
      if (seg.statuses.length > 0) {
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

  // IndexedDB Hydration on mount for profile.id
  useEffect(() => {
    if (initialSegments && initialSegments.length > 0) {
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
          if (
            cachedCount > statuses.length ||
            (cached.segments.length > 1 && cachedCount > 0)
          ) {
            if (statuses.length > 0) {
              const merged = mergeFreshPageIntoSegments({
                currentSegments: cached.segments,
                incomingStatuses: statuses,
                incomingNextMaxStatusId: initialNextMaxStatusId ?? null,
                incomingPrevMinStatusId: statuses[0]?.id ?? null
              })
              setSegments(merged.segments)
            } else {
              setSegments(cached.segments)
            }
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
            if (cached.scrollAnchor) {
              setPendingScrollAnchor(cached.scrollAnchor)
            }
          }
        }
      } catch {
        // offline read errors are silently ignored
      }
    }
    void hydrateFromOffline()
    return () => {
      isCancelled = true
    }
  }, [profile.id, initialSegments, statuses, initialNextMaxStatusId])

  // Offline persistence whenever segments or context change
  useEffect(() => {
    if (segments.length === 0) return
    const actorId = profile.id
    void saveOfflineTimeline({
      actorId,
      timeline: 'home',
      segments,
      ancestorsById: currentTimelineContext?.ancestorsById ?? {},
      lastRefreshedAt: lastRefreshedAt ?? Date.now()
    })
  }, [profile.id, segments, currentTimelineContext, lastRefreshedAt])

  // Scroll anchor restoration
  useLayoutEffect(() => {
    if (!pendingScrollAnchor || !pendingScrollAnchor.statusId) return
    if (restoredAnchorRef.current === pendingScrollAnchor.statusId) return

    const escapedId = pendingScrollAnchor.statusId.replace(/"/g, '\\"')
    const el = document.querySelector(`[data-status-id="${escapedId}"]`)
    if (el) {
      const rect = el.getBoundingClientRect()
      const diff = rect.top - pendingScrollAnchor.offsetTop
      if (Math.abs(diff) > 2) {
        window.scrollBy({ top: diff, behavior: 'instant' as ScrollBehavior })
      }
      restoredAnchorRef.current = pendingScrollAnchor.statusId
    }
  }, [pendingScrollAnchor, segments])

  // Scroll anchor tracking
  useEffect(() => {
    if (typeof window === 'undefined') return

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const recordScrollAnchor = () => {
      const actorId = activeProfileIdRef.current
      const elements =
        document.querySelectorAll<HTMLElement>('[data-status-id]')
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i]
        const rect = el.getBoundingClientRect()
        if (rect.bottom > 80) {
          const statusId = el.getAttribute('data-status-id')
          if (statusId) {
            const anchor: ScrollAnchorState = {
              statusId,
              offsetTop: Math.round(rect.top),
              updatedAt: Date.now()
            }
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

    const handleScroll = () => {
      if (timeoutId) return
      timeoutId = setTimeout(() => {
        timeoutId = null
        recordScrollAnchor()
      }, 200)
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        recordScrollAnchor()
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      window.removeEventListener('scroll', handleScroll)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // A new post composed in the top box, or a quote created inline from a
  // feed row, is prepended so it appears immediately.
  const onStatusCreated = (status: Status) => {
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
  }

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

      let capturedAnchor: { statusId: string; offsetTop: number } | null = null
      const shouldPreserve =
        options?.preserveScroll ??
        (typeof window !== 'undefined' && window.scrollY > 50)

      if (shouldPreserve && typeof document !== 'undefined') {
        const elements =
          document.querySelectorAll<HTMLElement>('[data-status-id]')
        for (let i = 0; i < elements.length; i++) {
          const el = elements[i]
          const rect = el.getBoundingClientRect()
          if (rect.bottom > 80) {
            const statusId = el.getAttribute('data-status-id')
            if (statusId) {
              capturedAnchor = { statusId, offsetTop: Math.round(rect.top) }
            }
            break
          }
        }
      }

      try {
        const result = await getTimeline({
          timeline: Timeline.MAIN
        })

        const merged = mergeFreshPageIntoSegments({
          currentSegments: segmentsRef.current,
          incomingStatuses: result.statuses,
          incomingNextMaxStatusId: result.nextMaxStatusId,
          incomingPrevMinStatusId: result.prevMinStatusId
        })
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

        const now = Date.now()
        setLastRefreshedAt(now)
        setNewerPostsCount(0)
        lastFailedFetchRef.current = null

        if (capturedAnchor) {
          restoredAnchorRef.current = null
          setPendingScrollAnchor({
            statusId: capturedAnchor.statusId,
            offsetTop: capturedAnchor.offsetTop,
            updatedAt: now
          })
        }

        // Trigger background batch revalidation of up to 80 cached status.ids outside
        // the newly fetched top page (throttled to at most once every 5 minutes per mount)
        if (now - lastReconciledAtRef.current > 5 * 60 * 1000) {
          lastReconciledAtRef.current = now
          const fetchedIds = new Set(result.statuses.map((s) => s.id))
          const cachedIdsOutsideTop: string[] = []
          for (const seg of segmentsRef.current) {
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
          setFetchError('Failed to load posts')
          lastFailedFetchRef.current = () => refreshTimeline(options)
        }
      } finally {
        setLoadingMoreStatuses(false)
        isLoadingRef.current = false
        setIsRefreshing(false)
      }
    },
    [onUnauthorized]
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

  const handleCleanTopSnapshot = useCallback(async () => {
    setNewerPostsCount(0)
    if (
      typeof window !== 'undefined' &&
      typeof window.scrollTo === 'function'
    ) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    await refreshTimeline({ preserveScroll: false })
  }, [refreshTimeline])

  // Offline / online listeners and auto-reconnect refresh
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false)
      void refreshTimeline({ preserveScroll: true })
    }
    const handleOffline = () => {
      setIsOffline(true)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refreshTimeline])

  useEffect(() => {
    if (refreshOnMount) {
      void refreshTimeline({ preserveScroll: true })
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
        (typeof navigator !== 'undefined' && !navigator.onLine)
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
          limit: 5
        })
        if (result.statuses && result.statuses.length > 0) {
          const currentIds = new Set(
            currentStatusesRef.current.map((s) => s.id)
          )
          const freshNewCount = result.statuses.filter(
            (s) => !currentIds.has(s.id)
          ).length
          if (freshNewCount > 0) {
            setNewerPostsCount(freshNewCount)
          }
        }
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
      <ScrollToTopButton
        isLoadMoreVisible={hasMoreStatuses && isLoadMoreVisible}
      />
      <PageHeader
        // Below `md` Refresh sits at the end of the compact bar, which then
        // carries the whole header, so the borderless, full-bleed composer
        // meets the bar's hairline directly.
        flushOnMobile
        actionsInMobileBar
        title="Timeline"
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
            {newerPostsCount > 0 ? (
              <Button
                type="button"
                variant="pill"
                onClick={handleCleanTopSnapshot}
                className="pointer-events-auto shadow-xs dark:bg-background dark:hover:bg-accent"
              >
                {newerPostsCount} new {newerPostsCount === 1 ? 'post' : 'posts'}{' '}
                ↑
              </Button>
            ) : null}
          </div>
        }
      />

      {isOffline && (
        <div
          role="status"
          className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground"
        >
          <div className="flex items-center gap-2">
            <span
              className="size-2 rounded-full bg-muted-foreground/60"
              aria-hidden="true"
            />
            <span>
              {lastRefreshedAt
                ? `Offline · Updated ${formatLastUpdated(lastRefreshedAt, currentTime)}`
                : 'Offline · Showing saved timeline'}
            </span>
          </div>
        </div>
      )}

      <section
        className={cn(POST_LIST_FRAME_CLASS, 'p-4', MOBILE_FEED_SURFACE_CLASS)}
      >
        {/* The home timeline keeps a top composer for brand-new posts. Reply,
            quote, and edit happen inline in the feed via the shared composer,
            like every other surface. */}
        <PostBox
          host={host}
          profile={profile}
          isMediaUploadEnabled={isMediaUploadEnabled}
          initialMedia={initialMedia}
          onDiscardReply={() => {}}
          onDiscardQuote={() => {}}
          onDiscardEdit={() => {}}
          onPostCreated={onStatusCreated}
          onPostUpdated={onPostUpdated}
        />
      </section>

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
              if (detailPath) router.push(detailPath)
            })()
          }}
        />
      ) : null}
    </div>
  )
}
