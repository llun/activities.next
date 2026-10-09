import { FC } from 'react'

import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// A connection's settings (Strava or Wahoo) under the Connections header and
// its own dropdown, which the layout keeps on screen: a titled panel of fields
// and buttons, and a second panel for the archive import.
const Panel: FC<{ fields: number }> = ({ fields }) => (
  <Frame className="space-y-5 p-6">
    <div className="space-y-2">
      <SkeletonBar className="h-6 w-40" />
      <SkeletonBar className="h-4 w-full" />
      <SkeletonBar className="h-4 w-2/3" />
    </div>
    {Array.from({ length: fields }, (_, index) => (
      <div key={index} className="space-y-2">
        <SkeletonBar className="h-4 w-28" />
        <SkeletonBar className="h-9 w-full" />
      </div>
    ))}
    <div className="flex gap-2">
      <SkeletonBar className="h-9 w-36" />
      <SkeletonBar className="h-9 w-20" />
    </div>
  </Frame>
)

const Loading: FC = () => (
  <div aria-busy="true" className="space-y-6">
    <span role="status" className="sr-only">
      Loading connection
    </span>
    <div aria-hidden="true" className="space-y-6">
      <Panel fields={3} />
      <Panel fields={1} />
    </div>
  </div>
)

export default Loading
