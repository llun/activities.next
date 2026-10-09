import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => (
  <SectionSkeleton sections={[1, 2, 2, 3, 3]} label="Loading federation" />
)

export default Loading
