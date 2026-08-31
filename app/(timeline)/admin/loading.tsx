import { FC } from 'react'

import { PageHeaderSkeleton, Skeleton } from '@/lib/components/ui/skeleton'

const Loading: FC = () => {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton hasAction={true} />

      {/* Main stat cards grid */}
      <div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        aria-hidden="true"
      >
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="rounded-2xl border bg-background/80 p-5 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        ))}
      </div>

      {/* Breakdown chart cards */}
      <div className="grid gap-6 md:grid-cols-2" aria-hidden="true">
        <div className="rounded-2xl border bg-background/80 p-6 shadow-sm space-y-4">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border bg-background/80 p-6 shadow-sm space-y-4">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}

export default Loading
