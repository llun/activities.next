import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

interface Props {
  /** What a screen reader hears while it loads: "Loading list editor". */
  label: string
  /** One entry per section: how many form rows its frame holds. */
  sections: number[]
}

/**
 * The shape of a list or collection editor while it loads, for a `loading.tsx`:
 * the page header with its title and description as bars, then the editor's
 * sections as heading bars over frames of form rows.
 */
export const EditorLoading: FC<Props> = ({ label, sections }) => (
  <div className="space-y-6">
    <PageHeader
      title={<SkeletonBar className="h-7 w-40" />}
      description={<SkeletonBar className="h-4 w-72 max-w-full" />}
    />
    <SectionSkeleton title={false} sections={sections} label={label} />
  </div>
)
