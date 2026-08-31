import { FC } from 'react'

import { PageHeaderSkeleton, Skeleton } from '@/lib/components/ui/skeleton'

const Loading: FC = () => {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      <div
        className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm space-y-4 p-4"
        aria-hidden="true"
      >
        {/* Region pills bar */}
        <div className="flex gap-2 pb-2 border-b border-border/60">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>

        {/* Map canvas container */}
        <Skeleton className="h-[480px] w-full rounded-xl" />
      </div>
    </div>
  )
}

export default Loading
