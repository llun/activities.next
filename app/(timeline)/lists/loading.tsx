import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// The lists index's shape while it loads: the header with its two create
// buttons, then a heading bar over a frame of rows (icon tile, name, summary)
// for each of the two groups.
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
      Loading lists and collections
    </span>
    <PageHeader
      title={<SkeletonBar className="h-7 w-52" />}
      description={<SkeletonBar className="h-4 w-80 max-w-full" />}
      stackActionsOnMobile
      actions={
        <div className="flex items-center gap-2">
          <SkeletonBar className="h-9 w-24" />
          <SkeletonBar className="h-9 w-36" />
        </div>
      }
    />
    <GroupSkeleton rows={2} />
    <GroupSkeleton rows={3} />
  </div>
)

export default ListsLoading
