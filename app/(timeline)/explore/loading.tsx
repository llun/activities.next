import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// `/explore` opens on the Hashtags tab: the header, the tab track and a framed
// list of trend rows (a name over a "people" line, and a sparkline).
export const ExploreLoading: FC = () => (
  <div aria-busy="true" className="space-y-6">
    <span role="status" className="sr-only">
      Loading explore
    </span>
    <PageHeader
      title={<SkeletonBar className="h-7 w-24" />}
      description={<SkeletonBar className="h-4 w-64 max-w-full" />}
    />
    <SkeletonBar className="h-11 w-full rounded-lg sm:w-72" />
    <Frame divided>
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="flex items-center justify-between gap-4 px-4 py-3"
        >
          <div className="min-w-0 space-y-2">
            <SkeletonBar className="h-4 w-32" />
            <SkeletonBar className="h-3 w-48 max-w-full" />
          </div>
          <SkeletonBar className="h-6 w-14 shrink-0" />
        </div>
      ))}
    </Frame>
  </div>
)

export default ExploreLoading
