import { FC } from 'react'

import { PageHeaderSkeleton, Skeleton } from '@/lib/components/ui/skeleton'

const Loading: FC = () => {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton hasAction={true} />

      {/* Lists section */}
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-6 w-24" />
        <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm divide-y divide-border/60">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between p-4">
              <div className="space-y-1.5 flex-1 min-w-0">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3.5 w-24" />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  <Skeleton className="h-7 w-7 rounded-full border-2 border-background" />
                  <Skeleton className="h-7 w-7 rounded-full border-2 border-background" />
                  <Skeleton className="h-7 w-7 rounded-full border-2 border-background" />
                </div>
                <Skeleton className="h-5 w-5 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Collections section */}
      <div className="space-y-3" aria-hidden="true">
        <Skeleton className="h-6 w-32" />
        <div className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm divide-y divide-border/60">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="flex items-center justify-between p-4">
              <div className="space-y-1.5 flex-1 min-w-0">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-3.5 w-48" />
              </div>
              <Skeleton className="h-5 w-5 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Loading
