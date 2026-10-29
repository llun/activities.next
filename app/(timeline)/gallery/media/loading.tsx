import { FC } from 'react'

import { GalleryGridSkeleton } from '@/lib/components/gallery/GalleryGridSkeleton'
import { PageHeader } from '@/lib/components/page-header'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// All media: no visible title of its own (the layout's Gallery dropdown row
// is the top of the screen), the Add and Select actions on its line from sm
// up, the category, show, filters, count and sort row, and the first photos
// with their caption lines — the shape GalleryAllMediaView draws, so nothing
// moves when it hydrates. The layout wrapper around this file is the same
// `relative` one the page renders in, so the actions' absolute placement
// lands on the dropdown's line exactly as the page's do.
const Loading: FC = () => (
  <div aria-busy="true" className="space-y-6">
    <PageHeader
      title="All media"
      srOnlyTitle
      className="sm:absolute sm:right-0 sm:top-0 md:top-4"
      actions={
        <div className="flex gap-2 sm:h-10 sm:items-center">
          <SkeletonBar className="pointer-coarse:h-10 h-9 w-20" />
          <SkeletonBar className="pointer-coarse:h-10 h-9 w-24" />
        </div>
      }
    />
    <div className="flex flex-col gap-2.5">
      {/* sm+: Type, Show and one Filters bar, with the count and Sort at
          the row's right end like the sheet-mode filter bar. */}
      <div className="hidden sm:flex flex-wrap items-center gap-2">
        <SkeletonBar className="h-10 w-64 rounded-lg" />
        <SkeletonBar className="h-10 w-52 rounded-lg" />
        <SkeletonBar className="h-10 w-24 rounded-lg" />
        <SkeletonBar className="ml-auto h-4 w-12" />
        <SkeletonBar className="h-10 w-36 rounded-lg" />
      </div>
      {/* Phones keep their two stacked bars. */}
      <div className="flex flex-wrap gap-2 sm:hidden">
        <SkeletonBar className="h-10 w-full" />
        <SkeletonBar className="h-10 w-full" />
      </div>
    </div>
    <GalleryGridSkeleton captions label="Loading all media" />
  </div>
)

export default Loading
