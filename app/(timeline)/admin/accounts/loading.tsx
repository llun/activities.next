import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => (
  <SectionSkeleton sections={[6]} headings={false} label="Loading accounts" />
)

export default Loading
