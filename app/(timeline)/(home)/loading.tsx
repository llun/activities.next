import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { PostListSkeleton } from '@/lib/components/posts/PostListSkeleton'
import {
  MOBILE_FEED_SURFACE_CLASS,
  POST_LIST_FRAME_CLASS
} from '@/lib/components/posts/feedLayout'
import { cn } from '@/lib/utils'

export const TimelineLoading: FC = () => {
  return (
    <div aria-busy="true" className="space-y-6">
      <span role="status" className="sr-only">
        Loading timeline
      </span>
      <PageHeader
        flushOnMobile
        actionsInMobileBar
        title={<span className="skeleton block h-7 w-24 rounded-md" />}
        actions={<div className="skeleton size-9 rounded-md" />}
      />

      <section
        aria-label="Post composer"
        className={cn(POST_LIST_FRAME_CLASS, 'p-4', MOBILE_FEED_SURFACE_CLASS)}
      >
        <div className="flex items-start gap-3">
          <div className="skeleton size-12 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="skeleton h-16 w-full rounded-md" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-1">
            <div className="skeleton size-8 rounded-md" />
            <div className="skeleton size-8 rounded-md" />
            <div className="skeleton size-8 rounded-md" />
            <div className="skeleton size-8 rounded-md" />
            <div className="skeleton size-8 rounded-md" />
            <div className="skeleton size-8 rounded-md" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="skeleton h-4 w-8 rounded" />
            <div className="skeleton h-8 w-16 rounded-md" />
          </div>
        </div>
      </section>

      <div
        aria-hidden="true"
        className="max-md:-mt-6 max-md:ml-[calc(50%_-_50vw)] max-md:h-px max-md:w-screen max-md:bg-border md:hidden"
      />

      <PostListSkeleton className="max-md:-mt-6" />
    </div>
  )
}

export default TimelineLoading
