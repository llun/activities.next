import { FC } from 'react'

import { PageHeaderSkeleton, Skeleton } from '@/lib/components/ui/skeleton'

const Loading: FC = () => {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton hasAction={true} />

      <div
        className="grid min-h-[500px] overflow-hidden rounded-2xl border bg-background/80 shadow-sm md:grid-cols-[320px_1fr]"
        aria-hidden="true"
      >
        {/* Left pane: conversation list */}
        <div className="border-r border-border/60 p-3 space-y-3">
          <Skeleton className="h-10 w-full rounded-lg" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="flex items-center gap-3 rounded-lg p-2.5"
              >
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex justify-between items-center">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-10" />
                  </div>
                  <Skeleton className="h-3.5 w-36" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right pane: message thread placeholder */}
        <div className="hidden md:flex flex-col justify-between p-4">
          <div className="flex items-center gap-3 border-b border-border/60 pb-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>

          <div className="space-y-3 py-6">
            <div className="flex gap-2 max-w-[70%]">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <Skeleton className="h-12 w-48 rounded-2xl rounded-tl-sm" />
            </div>
            <div className="flex justify-end">
              <Skeleton className="h-10 w-44 rounded-2xl rounded-tr-sm" />
            </div>
            <div className="flex gap-2 max-w-[70%]">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <Skeleton className="h-16 w-60 rounded-2xl rounded-tl-sm" />
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-t border-border/60">
            <Skeleton className="h-10 flex-1 rounded-lg" />
            <Skeleton className="h-10 w-10 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default Loading
