import { FC } from 'react'

import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'

// The handle form, the old-accounts list and the move form.
const Loading: FC = () => <SectionSkeleton sections={[4, 2, 3]} form />

export default Loading
