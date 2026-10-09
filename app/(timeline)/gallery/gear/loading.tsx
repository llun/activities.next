import { FC } from 'react'

import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'

import { GearListSkeleton } from './GalleryGearListView'

// The gallery's gear list: the title and its description, then the list
// view's own skeleton (a camera section and a lens section) with its status.
const Loading: FC = () => (
  <ScreenSkeleton
    titleWidth="w-16"
    description={<DescriptionSkeleton lines={[4, 2]} />}
  >
    <GearListSkeleton />
  </ScreenSkeleton>
)

export default Loading
