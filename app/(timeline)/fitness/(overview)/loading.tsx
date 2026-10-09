import { FC } from 'react'

import { OverviewSkeleton } from '@/app/(timeline)/fitness/ActorFitnessDashboard'
import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import { ScreenSkeleton } from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// The overview while the server reads it. From `md` up the loaded page puts the
// applied dates and the range picker in the title row; on a phone the
// dashboard's own skeleton carries them. Under it, the dashboard's skeleton (the
// same one the page draws until the viewer's time zone is known, with the one
// "Loading your fitness overview" status) and the Recent activities list.
const Loading: FC = () => (
  <ScreenSkeleton
    titleWidth="w-28"
    description={
      <div className="flex h-5 items-center max-md:hidden">
        <SkeletonBar className="h-4 w-36" />
      </div>
    }
    actions={
      <div className="flex gap-2 max-md:hidden">
        <SkeletonBar className="h-11 w-36" />
        <SkeletonBar className="size-11" />
      </div>
    }
  >
    <OverviewSkeleton />
    <div aria-hidden="true" className="space-y-3">
      <div className="flex h-6 items-center">
        <SkeletonBar className="h-5 w-40" />
      </div>
      <PostListSkeleton rows={3} />
    </div>
  </ScreenSkeleton>
)

export default Loading
