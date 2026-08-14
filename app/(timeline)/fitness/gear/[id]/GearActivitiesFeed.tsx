'use client'

import { FC, useCallback, useEffect, useRef, useState } from 'react'

import {
  type GearActivityStatusesPage,
  getFitnessGearActivities
} from '@/lib/client'
import { Posts } from '@/lib/components/posts/posts'
import { useLoadMoreOnVisible } from '@/lib/components/posts/useLoadMoreOnVisible'
import { Button } from '@/lib/components/ui/button'
import { Card } from '@/lib/components/ui/card'
import { PostLineLimit } from '@/lib/types/database/rows'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'

const ACTIVITIES_PAGE_SIZE = 20

/**
 * How many pages one load may walk before handing the reader a "Load more"
 * again. A page carries activity rows, and a row whose post was deleted
 * contributes no status, so a page can come back empty with more behind it.
 * Same guard, same reason, as `MAX_EMPTY_BOOKMARK_CONTINUATIONS` in the
 * bookmarks timeline: keep the button useful without letting one click walk a
 * whole history.
 */
const MAX_PAGES_PER_LOAD = 5

/**
 * One load: pages forward from `startOffset` until a page carries a post, the
 * server says there is nothing more, or the walk hits its cap.
 *
 * The walk is what makes an answer settled. A page of 20 activity rows can
 * yield zero statuses — deleting a post only nulls `fitness_files.statusId`,
 * and the row survives and keeps counting toward the gear's totals — so
 * "0 posts" on its own says nothing about whether the history is empty. Both
 * the initial load and "Load more" go through here so neither can hand back a
 * page that is empty for that reason alone: the first render would otherwise
 * claim the gear has no activities while an enabled "Load more" sat under it.
 *
 * `isCurrent` is checked after every round trip rather than once at the end,
 * so a walk superseded by a gear change stops at the next page instead of
 * running its remaining requests out.
 */
const loadPageWithPosts = async (
  gearId: string,
  startOffset: number,
  isCurrent: () => boolean
): Promise<GearActivityStatusesPage | null> => {
  let offset = startOffset
  for (let request = 0; request < MAX_PAGES_PER_LOAD; request += 1) {
    const page = await getFitnessGearActivities(gearId, {
      limit: ACTIVITIES_PAGE_SIZE,
      // Omitted rather than sent as 0 on the first page: the server defaults to
      // it, and the request reads as "the first page" in a network log.
      ...(offset > 0 ? { offset } : {})
    })
    if (!isCurrent()) return null
    offset = page.nextOffset
    if (page.statuses.length > 0 || !page.hasMore) return page
  }
  // Capped out on postless rows. `hasMore` is still true, so the reader keeps a
  // "Load more" that resumes exactly where this walk stopped.
  return { statuses: [], hasMore: true, nextOffset: offset }
}

/**
 * Everything the feed needs from the server and nothing it can fetch itself,
 * bundled so the two levels between the page and the feed thread one prop
 * instead of five. Built once in the server page: `currentTime` in particular
 * MUST come from there, because a Client Component calling `Date.now()` during
 * render breaks hydration on every relative timestamp below it.
 */
export interface GearActivityFeedContext {
  host: string
  currentTime: number
  currentActor: ActorProfile
  isMediaUploadEnabled?: boolean
  postLineLimit?: PostLineLimit
}

interface Props extends GearActivityFeedContext {
  gearId: string
  /** Shown when this gear has no posted activity at all. */
  emptyMessage: string
}

/**
 * A gear's activities, rendered as the posts they were published as.
 *
 * This is the shared `Posts` feed, not a bespoke list: a fitness activity is a
 * status like any other, and the design shows it here with the same body, the
 * same stat chip and the same action row it has in the timeline. Both the
 * Activities view of a bike or pair of shoes and the whole of a device's page
 * render through here, so the two can never drift apart.
 *
 * Note what the feed can and cannot show. It pages over ACTIVITY ROWS and
 * renders the post each one was published as; an activity whose post has since
 * been deleted keeps its `fitness_files` row — status deletion only nulls
 * `statusId` — so it still counts toward the gear's Activities tile and its
 * distance, but there is nothing left to render for it here. The stat tile and
 * the feed can therefore legitimately disagree.
 */
export const GearActivitiesFeed: FC<Props> = ({
  gearId,
  host,
  currentTime,
  currentActor,
  isMediaUploadEnabled,
  postLineLimit,
  emptyMessage
}) => {
  const [statuses, setStatuses] = useState<Status[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The row offset the server handed back, which is NOT `statuses.length`:
  // rows whose post was deleted return no status, and paging from the list
  // length would re-request every row in between on each page.
  const offsetRef = useRef(0)
  // Which load of which gear is currently welcome. A monotonic token rather
  // than the gear id, because the id cannot tell "still gear A" from "went to
  // B and came back to A" — and a request outstanding across that round trip
  // would be appended to a list that has since been reset, with its rows
  // counted twice in the offset. This component is rendered at a fixed
  // position with no `key`, so switching gear swaps `gearId` on the SAME
  // instance and none of this is hypothetical.
  const generationRef = useRef(0)
  // Guards the load-more path against the sentinel firing again while a page
  // is still in flight — `useLoadMoreOnVisible` re-invokes on every
  // intersection, and state has not settled yet when it does.
  const isLoadingMoreRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const generation = generationRef.current + 1
    generationRef.current = generation
    offsetRef.current = 0
    // Reset here too, not only in `loadMore`'s `finally`: that branch is
    // skipped for a request this effect has just superseded, which would leave
    // the new gear's "Load more" disabled and reading "Loading..." forever.
    isLoadingMoreRef.current = false
    setIsLoadingMore(false)
    setIsLoading(true)
    // Reset before fetching, not after: the previous gear's posts would
    // otherwise stay on screen with the previous gear's `hasMore`, and a
    // "Load more" clicked in that window would page from the wrong offset and
    // skip the rows in between. `error` resets with them — left behind, the
    // previous gear's failure sits above the new gear's "Loading..." until
    // this fetch resolves, reporting a bike's outage on a device's page.
    setStatuses([])
    setHasMore(false)
    setError(null)

    loadPageWithPosts(gearId, 0, () => !cancelled)
      .then((page) => {
        if (cancelled || !page) return
        offsetRef.current = page.nextOffset
        setStatuses(page.statuses)
        setHasMore(page.hasMore)
        setError(null)
      })
      .catch((loadError) => {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load activities.'
        )
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [gearId])

  const loadMore = useCallback(async () => {
    if (isLoadingMoreRef.current) return
    const generation = generationRef.current
    isLoadingMoreRef.current = true
    setIsLoadingMore(true)
    try {
      const page = await loadPageWithPosts(
        gearId,
        offsetRef.current,
        // A newer load has started since, so these posts belong to a list
        // nobody is looking at any more.
        () => generationRef.current === generation
      )
      if (!page) return

      offsetRef.current = page.nextOffset
      setHasMore(page.hasMore)
      setError(null)
      // Deduplicated on append: this is offset pagination over a list that can
      // grow, so an activity imported between two pages shifts the window and
      // repeats the boundary row — which React then flags as a duplicate key.
      setStatuses((current) => {
        const seen = new Set(current.map((status) => status.id))
        return [
          ...current,
          ...page.statuses.filter((status) => !seen.has(status.id))
        ]
      })
    } catch (loadError) {
      if (generationRef.current !== generation) return
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load activities.'
      )
    } finally {
      if (generationRef.current === generation) {
        isLoadingMoreRef.current = false
        setIsLoadingMore(false)
      }
    }
  }, [gearId])

  const { loadMoreRef } = useLoadMoreOnVisible({
    enabled: hasMore && !isLoading,
    onLoadMore: loadMore
  })

  const removeStatus = (status: Status) =>
    setStatuses((current) => current.filter((item) => item.id !== status.id))

  const updateStatus = (status: Status) =>
    setStatuses((current) =>
      current.map((item) => (item.id === status.id ? status : item))
    )

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {isLoading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading...</Card>
      ) : statuses.length === 0 && !hasMore ? (
        // `!hasMore` is half the claim, not belt-and-braces. An empty list on
        // its own means "no posts on this page", which the walk above makes
        // rare but cannot make impossible — it caps out, and `onPostDeleted`
        // can empty a page-one list at any time. Saying "no activities" with
        // more still to come contradicts both the Activities tile above and
        // the "Load more" below.
        <Card className="p-6 text-sm text-muted-foreground">
          {emptyMessage}
        </Card>
      ) : (
        <Posts
          host={host}
          currentTime={currentTime}
          currentActor={currentActor}
          showActions
          statuses={statuses}
          isMediaUploadEnabled={isMediaUploadEnabled}
          postLineLimit={postLineLimit}
          onPostDeleted={removeStatus}
          onPostUpdated={updateStatus}
        />
      )}

      {hasMore && !isLoading && (
        <div ref={loadMoreRef} className="text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
