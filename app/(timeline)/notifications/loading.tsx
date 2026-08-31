import { FC } from 'react'

import {
  NotificationRowSkeleton,
  PageHeaderSkeleton,
  Skeleton
} from '@/lib/components/ui/skeleton'

const Loading: FC = () => {
  return (
    <div className="space-y-6">
      {/* Subnav filter tabs placeholder */}
      <div
        className="flex gap-2 border-b border-border/60 pb-3"
        aria-hidden="true"
      >
        <Skeleton className="h-9 w-16 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>

      <PageHeaderSkeleton hasAction={true} />

      <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <NotificationRowSkeleton />
        <NotificationRowSkeleton />
        <NotificationRowSkeleton />
        <NotificationRowSkeleton />
        <NotificationRowSkeleton />
        <NotificationRowSkeleton />
      </div>
    </div>
  )
}

export default Loading
