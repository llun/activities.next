import { FC } from 'react'

import { PostSkeleton, Skeleton } from '@/lib/components/ui/skeleton'

export const StatusLoading: FC = () => {
  return (
    <div
      aria-busy="true"
      aria-label="Loading post"
      className="mt-4 overflow-hidden rounded-2xl border bg-background/80 shadow-sm"
    >
      {/* Header bar */}
      <div className="flex items-center gap-4 border-b p-4" aria-hidden="true">
        <Skeleton className="h-9 w-9 rounded-md" />
        <Skeleton className="h-6 w-24" />
      </div>

      {/* Focused post detail */}
      <div className="space-y-4 border-b p-6" aria-hidden="true">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
        </div>

        <Skeleton className="h-4 w-32 pt-2" />

        <div className="flex gap-6 border-t pt-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>

      {/* Replies list */}
      <div className="divide-y" aria-hidden="true">
        <PostSkeleton framed={false} />
        <PostSkeleton framed={false} />
      </div>
    </div>
  )
}

export default StatusLoading
