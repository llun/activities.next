import { FC } from 'react'

import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { StatStrip } from '@/lib/components/surface/StatStrip'

// The overview's shape while it loads: the title, the two stat strips (the
// real `StatStrip`, so the columns follow the same container queries as the
// loaded page and nothing jumps) and the chart's heading over its frame. Every other admin route draws its own
// `SectionSkeleton`; this one is for `/admin` itself.
const StripSkeleton: FC<{ cells: 3 | 4 }> = ({ cells }) => (
  <StatStrip columns={cells}>
    {Array.from({ length: cells }, (_, index) => (
      <div key={index} className="bg-background space-y-2 px-4 py-3">
        <SkeletonBar className="h-6 w-16" />
        <SkeletonBar className="h-4 w-24" />
      </div>
    ))}
  </StatStrip>
)

const Loading: FC = () => (
  <div
    role="status"
    aria-busy="true"
    data-slot="section-skeleton"
    className="space-y-6"
  >
    <span className="sr-only">Loading overview</span>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="space-y-2">
        <SkeletonBar className="h-7 w-32" />
        <SkeletonBar className="h-4 w-56 max-w-full" />
      </div>
      <SkeletonBar className="h-9 w-44 shrink-0" />
    </div>
    <div className="space-y-3">
      <SkeletonBar className="h-5 w-72 max-w-full" />
      <StripSkeleton cells={4} />
      <StripSkeleton cells={3} />
    </div>
    <div className="space-y-3">
      <SkeletonBar className="h-5 w-40" />
      <Frame className="p-4">
        <SkeletonBar className="h-[200px] w-full" />
      </Frame>
    </div>
  </div>
)

export default Loading
