import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// The lists index's shape while it loads: the header with its create button,
// then a heading bar over a frame of rows (icon tile, name, summary).
const GroupSkeleton: FC<{ rows: number }> = ({ rows }) => (
  <div className="space-y-3">
    <div className="space-y-2">
      <SkeletonBar className="h-5 w-32" />
      <SkeletonBar className="h-4 w-48 max-w-full" />
    </div>
    <Frame divided>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-3">
          <SkeletonBar className="size-10 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className="h-4 w-40 max-w-full" />
            <SkeletonBar className="h-3.5 w-52 max-w-full" />
          </div>
          <SkeletonBar className="size-5 shrink-0" />
        </div>
      ))}
    </Frame>
  </div>
)

export const ListsLoading: FC = () => (
  <div aria-busy="true" className="space-y-6">
    <span role="status" className="sr-only">
      Loading lists
    </span>
    <PageHeader
      title={<SkeletonBar className="h-7 w-52" />}
      description={<SkeletonBar className="h-4 w-80 max-w-full" />}
      stackActionsOnMobile
      actions={<SkeletonBar className="h-9 w-28" />}
    />
    <GroupSkeleton rows={3} />
  </div>
)

export default ListsLoading
