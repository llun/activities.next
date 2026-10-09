import { FC } from 'react'

import { MobileNavigationTrigger } from '@/lib/components/layout/mobile-navigation-trigger'
import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { StatStrip } from '@/lib/components/surface/StatStrip'

import { ProfileCover } from './ProfileCover'

// The profile's shape while it loads: the cover, the avatar over the name,
// handle and bio, the counts strip, the tab track and a framed list of posts.
export const ProfileLoading: FC = () => {
  return (
    <div
      aria-busy="true"
      className="flex flex-col gap-6 md:pt-8 group-data-[shell=public]/shell:pt-0"
    >
      <span role="status" className="sr-only">
        Loading profile
      </span>
      <MobileNavigationTrigger variant="floating" />
      <section aria-label="Profile" className="flex flex-col gap-4">
        <ProfileCover>
          <SkeletonBar className="h-36 rounded-none md:h-52" />
        </ProfileCover>

        <div className="relative px-4">
          <SkeletonBar className="-mt-14 size-20 rounded-full border-4 border-background" />

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 space-y-2">
              <SkeletonBar className="h-7 w-48 max-w-full" />
              <SkeletonBar className="h-4 w-32" />
            </div>
            <SkeletonBar className="h-9 w-28 shrink-0" />
          </div>

          <div className="mt-4 space-y-2">
            <SkeletonBar className="h-4 w-3/4" />
            <SkeletonBar className="h-4 w-1/2" />
          </div>
        </div>

        <StatStrip variant="counts" columns={3}>
          {[0, 1, 2].map((index) => (
            <div key={index} className="bg-background space-y-2 px-4 py-3">
              <SkeletonBar className="h-6 w-12" />
              <SkeletonBar className="h-4 w-20" />
            </div>
          ))}
        </StatStrip>
      </section>

      <div className="space-y-4">
        <SkeletonBar className="h-11 w-full rounded-lg sm:w-80" />
        <PostListSkeleton />
      </div>
    </div>
  )
}

export default ProfileLoading
