import { FC } from 'react'

import { GalleryGridSkeleton } from '@/lib/components/gallery/GalleryGridSkeleton'
import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'

// The album page's skeleton: the Back row, the cover hero, the facts lines,
// the sort row and a grid of tiles, each in the container the loaded
// `PublicGalleryAlbumView` uses, so the first tile lands where the loaded
// grid will. It stands in for the profile's `loading.tsx` above it, whose
// banner and avatar would flash for a page that has neither. It keeps what
// the loaded page puts around the content, so nothing moves when the album
// arrives: the signed-in mobile bar (the menu button; logged out it renders
// nothing) and the signed-in desktop top padding (the public shell has its
// own spacing).
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
      {/* The Back link and Copy link in the loaded row's own container:
          below `md` the Back row is `max-md:min-h-11` (44px), from `md` the
          Copy link Button (`h-8`, `pointer-coarse:h-10`) sets the row's 32px
          and the Back link collapses to its icon-and-label line (h-6). */}
      <div
        aria-hidden="true"
        className="flex items-center justify-between gap-3"
      >
        <div className="skeleton h-6 w-28 rounded-md max-md:min-h-11" />
        <div className="skeleton h-8 w-24 rounded-md pointer-coarse:h-10" />
      </div>
      {/* The hero's cover with the title and date range over it, in the
          hero's own box. The owner notice never shows for a visitor, and the
          description paragraph is data-dependent and usually absent, so both
          stay out; the subtitle is the common case (a dated album). */}
      <div
        aria-hidden="true"
        className="skeleton relative aspect-[4/3] w-full overflow-hidden rounded-lg border sm:aspect-[16/7]"
      >
        <div className="absolute inset-x-0 bottom-0 p-4 text-white sm:p-6">
          <div className="skeleton h-8 w-2/3 rounded sm:h-9" />
          <div className="skeleton mt-1 h-5 w-1/3 rounded" />
        </div>
      </div>
      {/* The facts line (text-sm) and the byline (text-xs) in their
          `space-y-1` block. */}
      <div aria-hidden="true" className="space-y-1">
        <div className="skeleton h-5 w-2/3 rounded" />
        <div className="skeleton h-4 w-1/2 rounded" />
      </div>
      {/* The sort row and the grid in the loaded `space-y-4` section. The
          species chips are data-dependent; they are `h-8`, so the Select
          (`h-9`, `pointer-coarse:h-10`) sets the row's height either way. */}
      <div className="space-y-4">
        <div
          aria-hidden="true"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <span />
          <div className="skeleton h-9 w-40 rounded-md pointer-coarse:h-10" />
        </div>
        {/* The wrapper above already says "Loading album", so the skeleton
            stays silent; its tiles are aria-hidden like the placeholders
            above. */}
        <GalleryGridSkeleton />
      </div>
    </div>
  </>
)

export default Loading
