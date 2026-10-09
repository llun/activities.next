import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// A list's timeline while it loads: the header (title, member count, Edit)
// and one frame of post rows, an avatar and two lines of text each, like the
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
    <Frame divided>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex gap-3 px-4 py-3">
          <SkeletonBar className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className="h-4 w-40 max-w-full" />
            <SkeletonBar className="h-4 w-full" />
            <SkeletonBar className="h-4 w-4/5" />
          </div>
        </div>
      ))}
    </Frame>
  </div>
)

export default ListTimelineLoading
