import { FC } from 'react'

import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

// Files: the title, then Storage, Import activities and the file list as
// heading bars over frames.
const Loading: FC = () => (
  <ScreenSkeleton
    titleWidth="w-16"
    description={<DescriptionSkeleton lines={[2, 1]} />}
  >
    <SectionSkeleton
      title={false}
      sections={[1, 2, 3]}
      label="Loading fitness files"
    />
  </ScreenSkeleton>
)

export default Loading
