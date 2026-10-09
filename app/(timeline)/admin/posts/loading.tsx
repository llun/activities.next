import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => (
  <SectionSkeleton
    sections={[2, 4, 2, 3]}
    label="Loading posts and media settings"
  />
)

export default Loading
