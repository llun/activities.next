import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => (
  <SectionSkeleton sections={[4, 2]} label="Loading account" />
)

export default Loading
