import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

// The index's identity card; the section layout already draws the list below.
const Loading: FC = () => (
  <SectionSkeleton sections={[1]} title={false} headings={false} />
)

export default Loading
