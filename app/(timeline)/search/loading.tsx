import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

export const SearchLoading: FC = () => {
  return (
    <div aria-busy="true" className="space-y-6">
      <span role="status" className="sr-only">
        Loading search
      </span>
      <PageHeader
        title={<SkeletonBar className="h-7 w-24" />}
        description={<SkeletonBar className="h-4 w-48 max-w-full" />}
      />

      <section aria-label="Search form" className="flex gap-2">
        <SkeletonBar className="h-9 flex-1" />
        <SkeletonBar className="h-9 w-20 shrink-0" />
      </section>

      <SkeletonBar className="h-11 w-full rounded-lg" />

      <Frame divided>
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex items-start gap-3 px-4 py-3">
            <SkeletonBar className="size-11 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBar className="h-4 w-40 max-w-full" />
              <SkeletonBar className="h-3.5 w-4/5" />
            </div>
          </div>
        ))}
      </Frame>
    </div>
  )
}

export default SearchLoading
