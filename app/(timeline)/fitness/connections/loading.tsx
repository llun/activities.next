import { FC } from 'react'

import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// A connection's settings (Strava or Wahoo) under the Connections header and
// its own dropdown, which the layout keeps on screen: a Section's heading and
// description bars, then one Frame of two-column rows (label and hint on the
// left, control on the right) with a footer rule and a right-aligned button.
const Panel: FC<{ fields: number }> = ({ fields }) => (
  <div className="space-y-3">
    <div className="space-y-2">
      <SkeletonBar className="h-5 w-40" />
      <SkeletonBar className="h-4 w-full max-w-xl" />
    </div>
    <Frame
      form
      footer={
        <div className="flex justify-end gap-2">
          <SkeletonBar className="h-9 w-20" />
          <SkeletonBar className="h-9 w-32" />
        </div>
      }
    >
      {Array.from({ length: fields }, (_, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 px-4 py-2.5 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:items-center sm:gap-6"
        >
          <div className="space-y-1.5">
            <SkeletonBar className="h-4 w-28" />
            <SkeletonBar className="h-3 w-40" />
          </div>
          <SkeletonBar className="h-9 w-full" />
        </div>
      ))}
    </Frame>
  </div>
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
