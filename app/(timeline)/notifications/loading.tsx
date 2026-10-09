import { FC } from 'react'

import { PageHeader, PageSubnavProvider } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// The notifications feed's shape while it loads: the header with its filter
// tabs and actions, then one frame of rows, each a type badge, a headline, a
// line of body and a time, so the page does not jump when the rows arrive.
export const NotificationsLoading: FC = () => (
  <div aria-busy="true" data-slot="section-skeleton">
    <span role="status" className="sr-only">
      Loading notifications
    </span>
    <PageSubnavProvider subnav={<SkeletonBar className="h-9 w-40" />}>
      <PageHeader
        title={<SkeletonBar className="h-7 w-40" />}
        description={<SkeletonBar className="h-4 w-72 max-w-full" />}
        actions={<SkeletonBar className="h-9 w-40" />}
      />
    </PageSubnavProvider>

    <div className="pt-4">
      <Frame divided className="overflow-hidden">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex gap-3 px-4 py-3.5">
            <SkeletonBar className="size-7 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <SkeletonBar className="h-4 w-56 max-w-[70%]" />
                <SkeletonBar className="h-3 w-16 shrink-0" />
              </div>
              <SkeletonBar className="h-4 w-4/5" />
            </div>
          </div>
        ))}
      </Frame>
    </div>
  </div>
)

export default NotificationsLoading
