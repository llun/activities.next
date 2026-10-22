import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

export const DraftsLoading: FC = () => (
  <div className="space-y-6">
    <PageHeader
      title={<SkeletonBar className="h-7 w-24" />}
      description={<SkeletonBar className="h-4 w-40 max-w-full" />}
    />
    <SectionSkeleton sections={[3]} title={false} label="Loading drafts" />
  </div>
)

export default DraftsLoading
