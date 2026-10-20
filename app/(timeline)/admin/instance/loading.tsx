import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => (
  <SectionSkeleton
    sections={[4, 2, 2, 3]}
    form
    label="Loading instance settings"
  />
)

export default Loading
