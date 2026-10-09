import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

// A collection's shape while it loads: the header, the frame of facts (badges,
// description, share link), then one frame of feed rows (avatar and two lines
// of text each), like the posts that replace them.
export const CollectionLoading: FC = () => (
  <div aria-busy="true" className="space-y-6">
    <span role="status" className="sr-only">
      Loading collection
    </span>
    {/* Signed in: the page's PageHeader. A logged-out visitor has no header
        band, only the plain title and byline in the cards' column. */}
    <PageHeader
      className="group-data-[shell=public]/shell:hidden"
      compactTitle="Collection"
      title={<SkeletonBar className="h-7 w-52" />}
      description={<SkeletonBar className="h-4 w-48 max-w-full" />}
      actions={<SkeletonBar className="h-8 w-16" />}
    />
    <div className="mb-4 hidden space-y-1 group-data-[shell=public]/shell:block">
      <SkeletonBar className="h-7 w-52" />
      <SkeletonBar className="h-4 w-40" />
    </div>
    <Frame divided>
      <div className="space-y-3 px-4 py-3">
        <div className="flex gap-1.5">
          <SkeletonBar className="h-5 w-16 rounded-full" />
          <SkeletonBar className="h-5 w-20 rounded-full" />
        </div>
        <SkeletonBar className="h-4 w-3/4" />
      </div>
      <div className="px-4 py-3">
        <SkeletonBar className="h-8 w-full" />
      </div>
    </Frame>
    <Frame divided>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex gap-3 px-4 py-3">
          <SkeletonBar className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBar className="h-4 w-40 max-w-full" />
            <SkeletonBar className="h-4 w-full" />
            <SkeletonBar className="h-4 w-4/5" />
          </div>
        </div>
      ))}
    </Frame>
  </div>
)

export default CollectionLoading
