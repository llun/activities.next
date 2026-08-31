import { FC } from 'react'

import { Skeleton, UserRowSkeleton } from '@/lib/components/ui/skeleton'

export const FollowingLoading: FC = () => {
  return (
    <div aria-busy="true" aria-label="Loading following" className="space-y-6">
      <div className="flex items-start gap-3" aria-hidden="true">
        <Skeleton className="h-9 w-9 shrink-0 rounded-md" />
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      <div
        className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm"
        aria-hidden="true"
      >
        <UserRowSkeleton />
        <UserRowSkeleton />
        <UserRowSkeleton />
        <UserRowSkeleton />
        <UserRowSkeleton />
      </div>
    </div>
  )
}

export default FollowingLoading
