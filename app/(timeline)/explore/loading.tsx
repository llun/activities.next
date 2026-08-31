import { FC } from 'react'

import { PageHeaderSkeleton, Skeleton } from '@/lib/components/ui/skeleton'

const Loading: FC = () => {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />

      {/* Tabs */}
      <div
        className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1"
        aria-hidden="true"
      >
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
      </div>

      {/* Content card */}
      <div
        className="rounded-2xl border bg-card/80 p-4 shadow-sm space-y-3"
        aria-hidden="true"
      >
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-b-0"
          >
            <div className="w-full space-y-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3.5 w-48" />
            </div>
            <Skeleton className="h-6 w-14 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default Loading
