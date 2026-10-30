import { FC } from 'react'

import { GalleryGridSkeleton } from '@/lib/components/gallery/GalleryGridSkeleton'
import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'

// The album page's skeleton: the Back row, the cover and a grid of tiles. It
// stands in for the profile's `loading.tsx` above it, whose banner and avatar
// would flash for a page that has neither. It keeps what the loaded page puts
// around the content, so nothing moves when the album arrives: the signed-in
// mobile bar (the menu button; logged out it renders nothing) and the signed-in
// desktop top padding (the public shell has its own spacing).
const Loading: FC = () => (
  <>
    <MobileCompactHeader
      title={<span className="skeleton block h-5 w-16 rounded-md" />}
      as="p"
    />
    <div
      aria-busy="true"
      className="space-y-5 md:pt-8 group-data-[shell=public]/shell:md:pt-0"
    >
      <span className="sr-only">Loading album</span>
      <div
        aria-hidden="true"
        className="skeleton h-8 w-28 rounded-md max-md:h-11"
      />
      <div
        aria-hidden="true"
        className="skeleton aspect-[4/3] w-full rounded-lg sm:aspect-[16/7]"
      />
      <div aria-hidden="true" className="skeleton h-5 w-2/3 rounded" />
      {/* The wrapper above already says "Loading album", so the skeleton stays
          silent; its tiles are aria-hidden like the placeholders above. */}
      <GalleryGridSkeleton />
    </div>
  </>
)

export default Loading
