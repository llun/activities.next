import { FC } from 'react'

import {
  PostSkeleton,
  ProfileHeaderSkeleton,
  Skeleton
} from '@/lib/components/ui/skeleton'

export const ProfileLoading: FC = () => {
  return (
    <div aria-busy="true" aria-label="Loading profile" className="space-y-6">
      <ProfileHeaderSkeleton />

      <div className="space-y-4">
        {/* Timeline tab strip placeholder */}
        <div
          className="flex gap-2 border-b border-border/60 pb-3"
          aria-hidden="true"
        >
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
        </div>

        {/* Statuses list */}
        <div className="space-y-4" aria-hidden="true">
          <PostSkeleton framed={true} />
          <PostSkeleton framed={true} hasMedia />
          <PostSkeleton framed={true} />
        </div>
      </div>
    </div>
  )
}

export default ProfileLoading
