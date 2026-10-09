import { FC } from 'react'

import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'
import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

// Privacy: the title, then the Place, Hidden locations and Sharing sections as
// heading bars over frames of settings rows.
const Loading: FC = () => (
  <ScreenSkeleton
    titleWidth="w-20"
    description={<DescriptionSkeleton lines={[3, 2]} />}
  >
    <SectionSkeleton
      title={false}
      sections={[2, 1, 3]}
      label="Loading privacy settings"
    />
  </ScreenSkeleton>
)

export default Loading
