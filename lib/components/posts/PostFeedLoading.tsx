import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

interface Props {
  /** What a screen reader hears while it loads: "Loading bookmarks". */
  label: string
  /** The page title's width, so the bar is about as long as the real title. */
  titleWidth?: string
  /** Draw the one-line description under the title (default). */
  description?: boolean
}

/**
 * The loading screen of a page that is a page header over a list of posts
 * (bookmarks, favorites): the header's own title and description as bars, then
 * the post list frame with placeholder posts. Draws no text.
 */
export const PostFeedLoading: FC<Props> = ({
  label,
  titleWidth = 'w-28',
  description = true
}) => (
  <div aria-busy="true" className="space-y-6">
    <span role="status" className="sr-only">
      {label}
    </span>
    <PageHeader
      title={<SkeletonBar className={`h-7 ${titleWidth}`} />}
      description={
        description ? (
          <SkeletonBar className="h-4 w-48 max-w-full" />
        ) : undefined
      }
    />
    <PostListSkeleton />
  </div>
)
