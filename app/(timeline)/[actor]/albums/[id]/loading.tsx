import { FC } from 'react'

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
      <div
        aria-hidden="true"
        className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2"
      >
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="skeleton aspect-square rounded-md" />
        ))}
      </div>
    </div>
  </>
)

export default Loading
