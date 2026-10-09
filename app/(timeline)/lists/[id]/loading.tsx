import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// A list's timeline while it loads: the header (title, member count, Edit)
// and the post list frame of placeholder posts, full-bleed on a phone like the
// posts that replace them. Without this file the lists index skeleton would
// show on every list.
export const ListTimelineLoading: FC = () => (
  <div aria-busy="true" className="space-y-6">
    <span role="status" className="sr-only">
      Loading list
    </span>
    <PageHeader
      compactTitle="Lists"
      title={<SkeletonBar className="h-7 w-44" />}
      description={<SkeletonBar className="h-4 w-32 max-w-full" />}
      actions={<SkeletonBar className="h-8 w-16" />}
    />
    <PostListSkeleton rows={4} />
  </div>
)

export default ListTimelineLoading
