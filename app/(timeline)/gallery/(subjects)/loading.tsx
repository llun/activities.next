import { Images, ListChecks, MapPin, Shapes } from 'lucide-react'
import { FC } from 'react'

import {
  DescriptionSkeleton,
  ScreenSkeleton,
  StatStripSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// One category: its heading row over a grid of subject cards (a square photo
// and two caption lines), as `GalleryCategorySection` draws it.
const CategorySkeleton: FC<{ cards: number }> = ({ cards }) => (
  <div className="space-y-3">
    <div className="flex h-6 items-center">
      <SkeletonBar className="h-5 w-40" />
    </div>
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
      {Array.from({ length: cards }, (_, index) => (
        <div key={index} className="space-y-1.5">
          <SkeletonBar className="aspect-square h-auto" />
          <SkeletonBar className="h-4 w-4/5" />
          <SkeletonBar className="h-3.5 w-3/5" />
        </div>
      ))}
    </div>
  </div>
)

// Subjects (the Gallery's first page): the title, the totals strip, the
// category chips and the first categories' cards.
const Loading: FC = () => (
  <ScreenSkeleton
    label="Loading subjects"
    titleWidth="w-24"
    description={<DescriptionSkeleton />}
  >
    <div aria-hidden="true" className="space-y-6">
      <StatStripSkeleton
        cells={[
          { label: 'Photos and videos', icon: Images },
          { label: 'Species', icon: ListChecks },
          { label: 'Without a subject', icon: Shapes },
          { label: 'Places', icon: MapPin }
        ]}
      />
      <div className="flex flex-wrap gap-2">
        {['w-14', 'w-20', 'w-24', 'w-28', 'w-24'].map((width, index) => (
          // Chip widths vary with their labels.
          <SkeletonBar
            key={index}
            className={`h-[30px] rounded-full ${width}`}
          />
        ))}
      </div>
      <CategorySkeleton cards={4} />
      <CategorySkeleton cards={2} />
    </div>
  </ScreenSkeleton>
)

export default Loading
