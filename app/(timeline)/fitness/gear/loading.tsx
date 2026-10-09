import { FC } from 'react'

import {
  DescriptionSkeleton,
  ScreenSkeleton
} from '@/lib/components/surface/ScreenSkeleton'

import { GearListSkeleton } from './GearListView'

// The gear list while it loads: the page title and its long description, then
// the list view's own skeleton (two sections of a table) with its one status.
const Loading: FC = () => (
  <ScreenSkeleton
    titleWidth="w-16"
    description={<DescriptionSkeleton lines={[4, 2]} />}
  >
    <GearListSkeleton />
  </ScreenSkeleton>
)

export default Loading
