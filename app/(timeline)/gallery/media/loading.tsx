import { FC } from 'react'

import { GalleryGridSkeleton } from '@/lib/components/gallery/GalleryGridSkeleton'
import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// All media: the title with its Select action, the category and show filters
// and the first photos, each with its caption line.
const Loading: FC = () => (
  <ScreenSkeleton
    titleWidth="w-24"
    description={<DescriptionSkeleton />}
    actions={<SkeletonBar className="h-8 w-20" />}
  >
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <SkeletonBar className="h-10 w-full sm:w-64" />
        <SkeletonBar className="h-10 w-full sm:w-52" />
      </div>
      <GalleryGridSkeleton captions label="Loading all media" />
    </div>
  </ScreenSkeleton>
)

export default Loading
