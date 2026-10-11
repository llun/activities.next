import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => <SectionSkeleton sections={[2, 3, 1, 3]} form />

export default Loading
