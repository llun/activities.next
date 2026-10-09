import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => (
  <SectionSkeleton sections={[1, 1, 1, 3]} label="Loading network settings" />
)

export default Loading
