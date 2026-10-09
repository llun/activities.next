import { FC } from 'react'

// The album page's skeleton: the Back row, the cover and a grid of tiles. It
// stands in for the profile's `loading.tsx` above it, whose banner and avatar
// would flash for a page that has neither.
const Loading: FC = () => (
  <div aria-busy="true" className="space-y-5">
    <span className="sr-only">Loading album</span>
    <div aria-hidden="true" className="skeleton h-8 w-28 rounded-md" />
    <div
      aria-hidden="true"
      className="skeleton aspect-[4/3] w-full rounded-xl sm:aspect-[16/7]"
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
)

export default Loading
