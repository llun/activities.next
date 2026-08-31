import { FC } from 'react'

import {
  PageHeaderSkeleton,
  Skeleton,
  UserRowSkeleton
} from '@/lib/components/ui/skeleton'

const Loading: FC = () => {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      {/* Search form */}
      <div className="flex gap-2" aria-hidden="true">
        <Skeleton className="h-11 flex-1 rounded-md" />
        <Skeleton className="h-11 w-24 rounded-md" />
      </div>

      {/* Tabs */}
      <div
        className="grid grid-cols-4 gap-1 rounded-lg bg-muted/60 p-1"
        aria-hidden="true"
      >
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
      </div>

      {/* Results placeholder */}
      <div
        className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm"
        aria-hidden="true"
      >
        <UserRowSkeleton />
        <UserRowSkeleton />
        <UserRowSkeleton />
      </div>
    </div>
  )
}

export default Loading
