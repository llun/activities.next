import { Bird, Bug, Images, ListChecks } from 'lucide-react'
import { FC } from 'react'

import {
  DescriptionSkeleton,
  ScreenSkeleton,
  StatStripSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// Life list: the title, the totals strip and the species table (a header band
// over rows).
const Loading: FC = () => (
  <ScreenSkeleton
    label="Loading life list"
    titleWidth="w-24"
    description={<DescriptionSkeleton lines={[2, 1]} />}
  >
    <div aria-hidden="true" className="space-y-6">
      <StatStripSkeleton
        cells={[
          { label: 'Species', icon: ListChecks },
          { label: 'Photos', icon: Images },
          { label: 'Birds', icon: Bird },
          { label: 'Insects', icon: Bug }
        ]}
      />
      <div className="rounded-lg border">
        <div className="bg-muted/40 h-10 border-b" />
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-6 border-b px-4 py-3 last:border-b-0"
          >
            <SkeletonBar className="h-4 w-1/3 max-w-48" />
            <SkeletonBar className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  </ScreenSkeleton>
)

export default Loading
