import { FC } from 'react'

import { GalleryGridSkeleton } from '@/lib/components/gallery/GalleryGridSkeleton'
import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// Recent: the title with its Select action, the category filter and the first
// photos, each with its caption line.
const Loading: FC = () => (
  <ScreenSkeleton
    titleWidth="w-20"
    description={<DescriptionSkeleton />}
    actions={<SkeletonBar className="h-8 w-20" />}
  >
    <div className="space-y-4">
      <SkeletonBar className="h-9 w-48" />
      <GalleryGridSkeleton captions label="Loading recent photos" />
    </div>
  </ScreenSkeleton>
)

export default Loading
