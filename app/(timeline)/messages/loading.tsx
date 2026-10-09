import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'

import { MessageThreadSkeleton } from './MessageThreadSkeleton'

export const MessagesLoading: FC = () => {
  return (
    <div
      aria-busy="true"
      aria-label="Loading messages"
      className="flex min-h-0 flex-1 flex-col gap-5 md:gap-6"
    >
      <PageHeader
        // The column's flex gap would open between the mobile bar and this
        // row, which continues it; cancel it below `md`.
        className="max-md:-mt-5"
        title={<SkeletonBar className="h-7 w-28" />}
        description={<SkeletonBar className="h-4 w-60 max-w-full" />}
        actions={<SkeletonBar className="h-8 w-18" />}
      />

      <section
        aria-label="Direct messages"
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <Frame className="grid min-w-0 flex-1 overflow-hidden md:min-h-0 md:grid-cols-[minmax(260px,34%)_minmax(0,1fr)] lg:grid-cols-[minmax(320px,30%)_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside
            aria-label="Conversation list"
            className="min-w-0 border-b max-md:hidden md:min-h-0 md:border-b-0 md:border-r"
          >
            <div className="divide-y md:h-full md:overflow-y-auto">
              {[0, 1, 2, 3, 4].map((index) => (
                <div
                  key={index}
                  className="flex w-full items-start gap-3 px-3 py-3 md:px-4 md:py-4"
                >
                  <SkeletonBar className="mt-0.5 size-9 shrink-0 rounded-full md:size-11" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <SkeletonBar className="h-4 w-28 md:w-36" />
                    <SkeletonBar className="h-3.5 w-4/5" />
                    <SkeletonBar className="h-3 w-16" />
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <div
            aria-label="Conversation thread"
            className="flex min-h-[60svh] min-w-0 flex-col md:min-h-0"
          >
            <div className="flex min-h-14 items-center justify-between gap-3 border-b px-4 md:min-h-16 md:px-5">
              <SkeletonBar className="size-9 shrink-0 md:hidden" />
              <SkeletonBar className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1">
                <SkeletonBar className="h-5 w-32 md:w-40" />
                <SkeletonBar className="h-3.5 w-20 md:w-28" />
              </div>
              <SkeletonBar className="size-9 shrink-0" />
            </div>

            <div
              aria-label="Message thread"
              className="min-h-0 min-w-0 flex-1 overflow-y-auto"
            >
              <MessageThreadSkeleton />
            </div>

            <div className="border-t p-4 md:p-5">
              <div className="flex items-end gap-2">
                <SkeletonBar className="h-10 flex-1" />
                <SkeletonBar className="h-9 w-20 shrink-0" />
              </div>
            </div>
          </div>
        </Frame>
      </section>
    </div>
  )
}

export default MessagesLoading
