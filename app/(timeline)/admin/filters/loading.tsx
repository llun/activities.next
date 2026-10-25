import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => (
  <SectionSkeleton
    sections={[3]}
    headings={false}
    label="Loading server filters"
  />
)

export default Loading
