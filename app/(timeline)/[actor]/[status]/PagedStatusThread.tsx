'use client'

import { FC, useCallback, useMemo } from 'react'

import {
  StatusThread,
  type StatusThreadProps
} from '@/lib/components/posts/status-thread'
import { useThreadContextPager } from '@/lib/components/posts/useThreadContextPager'
import { Status } from '@/lib/types/domain/status'

const EMPTY_STATUSES: Status[] = []

type Props = Omit<
  StatusThreadProps,
  | 'onLoadMoreAncestors'
  | 'onLoadMoreDescendants'
  | 'loadingMore'
  | 'loadMoreError'
>

/**
 * The post page's thread with working "Load earlier posts" and "Load more
 * replies": the page renders the first limit step, and each load re-asks the
 * thread route at the next one (`useThreadContextPager`). `StatusThread` stays
 * mounted throughout, so the opened post, an open composer and the reader's
 * expanded branches survive a load.
 */
export const PagedStatusThread: FC<Props> = ({
  status,
  ancestors = EMPTY_STATUSES,
  descendants = EMPTY_STATUSES,
  hasMoreAncestors = false,
  hasMoreDescendants = false,
  ...props
}) => {
  const initial = useMemo(
    () => ({ ancestors, descendants, hasMoreAncestors, hasMoreDescendants }),
    [ancestors, descendants, hasMoreAncestors, hasMoreDescendants]
  )
  const getScrollAnchor = useCallback(
    () => document.querySelector<HTMLElement>('[data-testid="focused-status"]'),
    []
  )
  const thread = useThreadContextPager({
    statusId: status.id,
    initial,
    getScrollAnchor
  })

  return (
    <StatusThread
      {...props}
      status={status}
      ancestors={thread.ancestors}
      descendants={thread.descendants}
      hasMoreAncestors={thread.hasMoreAncestors}
      hasMoreDescendants={thread.hasMoreDescendants}
      onLoadMoreAncestors={thread.loadMoreAncestors}
      onLoadMoreDescendants={thread.loadMoreDescendants}
      loadingMore={thread.loading}
      loadMoreError={thread.error}
    />
  )
}
