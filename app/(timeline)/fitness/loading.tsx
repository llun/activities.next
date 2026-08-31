import { FC } from 'react'

import { PageHeaderSkeleton, Skeleton } from '@/lib/components/ui/skeleton'

const Loading: FC = () => {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      {/* Stats summary & Heatmap Card */}
      <div
        className="rounded-2xl border bg-background/80 p-6 shadow-sm space-y-6"
        aria-hidden="true"
      >
        {/* Metric tiles */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-1.5 rounded-xl bg-muted/40 p-4">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>

        {/* Heatmap graph placeholder */}
        <div className="space-y-2 pt-2">
          <div className="flex justify-between items-center">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      </div>

      {/* Recent activities section */}
      <div className="space-y-4" aria-hidden="true">
        <Skeleton className="h-6 w-36" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-2xl border bg-background/80 p-5 shadow-sm space-y-3"
            >
              <div className="flex justify-between items-start">
                <div className="space-y-1.5">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-3.5 w-28" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <div className="flex gap-6 pt-1">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Loading
