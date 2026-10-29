import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

// The index's profile card; the section layout already draws the list below.
const Loading: FC = () => (
  <SectionSkeleton
    sections={[1]}
    title={false}
    headings={false}
    className="max-w-[680px]"
  />
)

export default Loading
