import { FC } from 'react'

import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

import { RecordsSkeleton } from './PersonalRecordsView'

// Records while they load: the title and description, the range control, then
// the view's own skeleton (two lists of five rows) with its one status.
const Loading: FC = () => (
  <ScreenSkeleton titleWidth="w-20" description={<DescriptionSkeleton />}>
    <div className="space-y-6">
      <SkeletonBar className="h-11 w-72 max-w-full rounded-lg" />
      <RecordsSkeleton />
    </div>
  </ScreenSkeleton>
)

export default Loading
