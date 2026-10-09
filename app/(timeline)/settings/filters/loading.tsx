import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

const Loading: FC = () => <SectionSkeleton sections={[3]} headings={false} />

export default Loading
