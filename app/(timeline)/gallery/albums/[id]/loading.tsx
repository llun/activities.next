import { FC } from 'react'

import { BackLink } from '@/lib/components/back-link'
import { GalleryGridSkeleton } from '@/lib/components/gallery/GalleryGridSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// An album's page: the Back link, the cover hero, the action row and the first
// photos. The page has no `PageHeader`; the title sits on the cover.
const Loading: FC = () => (
  <div aria-busy="true" className="space-y-5">
    <BackLink href="/gallery/albums" accessibleName="Back to albums" />
    <div aria-hidden="true" className="space-y-5">
      <SkeletonBar className="aspect-[4/3] h-auto w-full rounded-lg sm:aspect-[16/7]" />
      <div className="flex flex-wrap items-center gap-2">
        <SkeletonBar className="h-8 w-28" />
        <SkeletonBar className="h-8 w-16" />
        <SkeletonBar className="h-8 w-28" />
        <SkeletonBar className="h-8 w-20" />
      </div>
    </div>
    <GalleryGridSkeleton label="Loading album" />
  </div>
)

export default Loading
