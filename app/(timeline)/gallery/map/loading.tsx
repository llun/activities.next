import { FC } from 'react'

import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// Map: the title, the subject filter and preview switch, the map block and the
// Places list under it.
const Loading: FC = () => (
  <ScreenSkeleton
    label="Loading map"
    titleWidth="w-12"
    description={<DescriptionSkeleton lines={[2, 1]} />}
  >
    <div aria-hidden="true" className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <SkeletonBar className="h-9 w-44" />
        <SkeletonBar className="h-5 w-40" />
      </div>
      <SkeletonBar className="h-[420px] rounded-lg" />
      <div className="space-y-3">
        <div className="flex h-6 items-center">
          <SkeletonBar className="h-5 w-20" />
        </div>
        <div className="divide-y rounded-lg border">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-3">
              <SkeletonBar className="size-10 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <SkeletonBar className="h-4 w-48 max-w-full" />
                <SkeletonBar className="h-3.5 w-36 max-w-full" />
              </div>
              <SkeletonBar className="h-4 w-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </ScreenSkeleton>
)

export default Loading
