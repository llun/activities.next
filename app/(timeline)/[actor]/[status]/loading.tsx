import { FC } from 'react'

import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'
import { MOBILE_FEED_SURFACE_CLASS } from '@/lib/components/posts/feedLayout'

export const StatusLoading: FC = () => {
  return (
    <>
      {/* The loaded page's mobile bar; its title ("Post" or "Activity") is
          not known until the status loads. */}
      <MobileCompactHeader
        title={<span className="skeleton block h-5 w-16 rounded-md" />}
      />
      <div
        aria-busy="true"
        aria-label="Loading post"
        className={`md:mt-4 overflow-hidden rounded-2xl border bg-background/80 shadow-sm group-data-[shell=public]/shell:mt-0 ${MOBILE_FEED_SURFACE_CLASS}`}
      >
        <div className="flex items-center gap-3 border-b bg-surface-chrome px-5 py-3 group-data-[shell=public]/shell:hidden max-md:bg-transparent max-md:px-4 max-md:py-0.5">
          <div className="skeleton h-8 w-8 rounded-md max-md:hidden" />
          {/* Mobile: the labelled Back row ("Back" / "Back to profile"). */}
          <div className="flex h-11 items-center gap-2 md:hidden">
            <div className="skeleton size-4 rounded-md" />
            <div className="skeleton h-4 w-24 rounded" />
          </div>
          <div className="space-y-1 max-md:hidden">
            <div className="skeleton h-4 w-16 rounded" />
            <div className="skeleton h-3 w-32 rounded" />
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-3">
            <div className="skeleton size-10 shrink-0 rounded-full" />
            <div className="space-y-1.5">
              <div className="skeleton h-4 w-36 rounded" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="skeleton h-4 w-full rounded" />
            <div className="skeleton h-4 w-5/6 rounded" />
            <div className="skeleton h-4 w-2/3 rounded" />
          </div>

          <div className="mt-4 flex gap-6 border-t pt-3">
            <div className="skeleton h-5 w-12 rounded" />
            <div className="skeleton h-5 w-12 rounded" />
            <div className="skeleton h-5 w-12 rounded" />
          </div>
        </div>
      </div>
    </>
  )
}

export default StatusLoading
