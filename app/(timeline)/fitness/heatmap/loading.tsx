import { FC } from 'react'

import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

// Heatmaps: the title and description, then the Regions list as a heading bar
// over a frame of region rows.
const Loading: FC = () => (
  <ScreenSkeleton
    titleWidth="w-24"
    description={<DescriptionSkeleton lines={[2, 1]} />}
  >
    <SectionSkeleton title={false} sections={[1]} label="Loading heatmaps" />
  </ScreenSkeleton>
)

export default Loading
