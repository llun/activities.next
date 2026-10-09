import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// The hashtag page is public, and the two shells head it differently: a signed
// in reader gets the sticky page header, a logged-out one a plain heading in
// `PublicShell`'s column. Both are drawn and the shell (`data-shell`) shows the
// right one, so the heading does not move when the posts arrive.
export const HashtagLoading: FC = () => (
  <div aria-busy="true" className="flex flex-col gap-6">
    <span role="status" className="sr-only">
      Loading hashtag
    </span>
    <PageHeader
      className="group-data-[shell=public]/shell:hidden"
      title={<SkeletonBar className="h-7 w-32" />}
      description={<SkeletonBar className="h-4 w-16" />}
    />
    <div className="hidden space-y-2 group-data-[shell=public]/shell:block">
      <SkeletonBar className="h-7 w-32" />
      <SkeletonBar className="h-4 w-16" />
    </div>
    <PostListSkeleton />
  </div>
)

export default HashtagLoading
