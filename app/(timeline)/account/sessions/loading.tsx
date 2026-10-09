import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => <SectionSkeleton sections={[2, 2, 1]} />

export default Loading
