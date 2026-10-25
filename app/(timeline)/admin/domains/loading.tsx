import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => (
  <SectionSkeleton
    sections={[4]}
    headings={false}
    label="Loading served domains"
  />
)

export default Loading
