import { FC } from 'react'

import { Frame } from '@/lib/components/surface/Frame'
import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// Privacy: the title and description, then the privacy location editor (its
// heading, a map block and the coordinate fields) and the route map section.
const Loading: FC = () => (
  <ScreenSkeleton
    label="Loading privacy settings"
    titleWidth="w-20"
    description={<DescriptionSkeleton lines={[2, 1]} />}
  >
    <div aria-hidden="true" className="space-y-6">
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex h-6 items-center">
            <SkeletonBar className="h-5 w-36" />
          </div>
          <DescriptionSkeleton lines={[3, 2]} />
        </div>
        <Frame className="space-y-4 p-4">
          <SkeletonBar className="h-[240px] w-full" />
          <div className="grid gap-4 sm:grid-cols-2">
            <SkeletonBar className="h-9" />
            <SkeletonBar className="h-9" />
          </div>
          <SkeletonBar className="h-9" />
        </Frame>
      </div>
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex h-6 items-center">
            <SkeletonBar className="h-5 w-44" />
          </div>
          <DescriptionSkeleton />
        </div>
      </div>
    </div>
  </ScreenSkeleton>
)

export default Loading
