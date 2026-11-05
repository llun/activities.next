import { FC } from 'react'

import { Frame } from '@/lib/components/surface/Frame'
import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// Zones: the title and description, then the training zones card (its
// heading and intro, the three number fields with their previews, and the
// footer).
const Loading: FC = () => (
  <ScreenSkeleton
    label="Loading training zones"
    titleWidth="w-16"
    description={<DescriptionSkeleton lines={[2, 1]} />}
  >
    <div aria-hidden="true" className="space-y-3">
      <div className="space-y-1">
        <div className="flex h-6 items-center">
          <SkeletonBar className="h-5 w-32" />
        </div>
        <DescriptionSkeleton lines={[2, 1]} />
      </div>
      <Frame className="space-y-4 p-4">
        <SkeletonBar className="h-9" />
        <SkeletonBar className="h-9" />
        <SkeletonBar className="h-28" />
        <SkeletonBar className="h-9" />
        <SkeletonBar className="h-32" />
        <SkeletonBar className="h-9" />
      </Frame>
    </div>
  </ScreenSkeleton>
)

export default Loading
