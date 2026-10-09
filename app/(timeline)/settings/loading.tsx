import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => <SectionSkeleton sections={[2, 5, 1, 1]} />

export default Loading
