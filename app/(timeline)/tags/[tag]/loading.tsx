import { FC } from 'react'

import { PostSkeleton, Skeleton } from '@/lib/components/ui/skeleton'

const Loading: FC = () => {
  return (
    <div className="space-y-6">
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        aria-hidden="true"
      >
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      <div className="space-y-4">
        <PostSkeleton framed={true} />
        <PostSkeleton framed={true} hasMedia />
        <PostSkeleton framed={true} />
      </div>
    </div>
  )
}

export default Loading
