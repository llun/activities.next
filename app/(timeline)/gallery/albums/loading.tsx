import { FolderOpen, Images, Sparkles } from 'lucide-react'
import { FC } from 'react'

import {
  DescriptionSkeleton,
  ScreenSkeleton,
  StatStripSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// Albums: the title with New album, the totals strip, the visibility chips and
// a grid of album cards (a 3:2 cover, a name line and a meta line).
const Loading: FC = () => (
  <ScreenSkeleton
    label="Loading albums"
    titleWidth="w-20"
    description={<DescriptionSkeleton />}
    actions={<SkeletonBar className="h-8 w-28" />}
  >
    <div aria-hidden="true" className="space-y-6">
      <StatStripSkeleton
        cells={[
          { label: 'Albums', icon: FolderOpen },
          { label: 'Photos in albums', icon: Images },
          { label: 'Suggested', icon: Sparkles }
        ]}
      />
      <div className="flex gap-2">
        <SkeletonBar className="h-8 w-16 rounded-full" />
        <SkeletonBar className="h-8 w-20 rounded-full" />
        <SkeletonBar className="h-8 w-20 rounded-full" />
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3 md:gap-x-4">
        {Array.from({ length: 6 }, (_, index) => (
          <li key={index} className="min-w-0 space-y-2">
            <SkeletonBar className="aspect-[3/2] h-auto rounded-lg" />
            <SkeletonBar className="h-4 w-3/5" />
            <SkeletonBar className="h-3.5 w-4/5" />
          </li>
        ))}
      </ul>
    </div>
  </ScreenSkeleton>
)

export default Loading
