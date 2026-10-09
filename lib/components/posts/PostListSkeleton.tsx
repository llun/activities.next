import { FC } from 'react'

import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { cn } from '@/lib/utils'

import { MOBILE_FEED_SURFACE_CLASS, POST_LIST_FRAME_CLASS } from './feedLayout'

interface Props {
  /** How many placeholder posts (default 3). */
  rows?: number
  /**
   * Keep the phone-width bleed of the loaded feed (default). Turn it off for a
   * list drawn inside a column that is already inset.
   */
  bleed?: boolean
  className?: string
}

/**
 * The shape of a post list while it loads: the post list frame with one row per
 * placeholder post (an avatar, a name line and two lines of text), so the page
 * does not jump when the posts arrive. Draws no text; the route's own loading
 * region names what is loading for assistive tech.
 */
export const PostListSkeleton: FC<Props> = ({
  rows = 3,
  bleed = true,
  className
}) => (
  <div
    data-slot="post-list-skeleton"
    className={cn(
      POST_LIST_FRAME_CLASS,
      'divide-y divide-border overflow-hidden',
      bleed && MOBILE_FEED_SURFACE_CLASS,
      className
    )}
  >
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="flex gap-3 px-4 py-3">
        <SkeletonBar className="size-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <SkeletonBar className="h-4 w-40 max-w-full" />
          <SkeletonBar className="h-4 w-full" />
          <SkeletonBar className="h-4 w-4/5" />
        </div>
      </div>
    ))}
  </div>
)
