import { FC } from 'react'

import { MobileCompactHeader } from '@/lib/components/layout/mobile-compact-header'
import {
  MOBILE_FEED_SURFACE_CLASS,
  POST_LIST_FRAME_CLASS
} from '@/lib/components/posts/feedLayout'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { cn } from '@/lib/utils'

// The loaded logged-out page is a stack of inset frames below `md` (see
// `MOBILE_INSET_STACK_CLASS`), so this single placeholder frame, which stands in
// for its thread frame, undoes `MOBILE_FEED_SURFACE_CLASS` there: it takes the
// frame's own width and outline, and with `PublicShell`'s `py-6` as its only top
// spacing it starts where the loaded frame does.
const PUBLIC_MOBILE_INSET_CARD_CLASS =
  'group-data-[shell=public]/shell:max-md:mx-0 group-data-[shell=public]/shell:max-md:rounded-lg group-data-[shell=public]/shell:max-md:border'

export const StatusLoading: FC = () => {
  return (
    <>
      {/* The loaded page's mobile bar (signed in only — the public shell
          provides no mobile navigation); its title ("Post" or "Activity") is
          not known until the status loads. */}
      <MobileCompactHeader title={<SkeletonBar className="h-5 w-16" />} />
      <div
        aria-busy="true"
        className={cn(
          POST_LIST_FRAME_CLASS,
          'overflow-hidden md:mt-4 group-data-[shell=public]/shell:mt-0',
          MOBILE_FEED_SURFACE_CLASS,
          PUBLIC_MOBILE_INSET_CARD_CLASS
        )}
      >
        <span role="status" className="sr-only">
          Loading post
        </span>
        <div className="flex items-center gap-3 border-b bg-surface-chrome px-5 py-3 group-data-[shell=public]/shell:hidden max-md:bg-transparent max-md:px-4 max-md:py-0.5">
          <SkeletonBar className="size-8 max-md:hidden" />
          {/* Mobile: the labelled Back row. */}
          <div className="flex h-11 items-center gap-2 md:hidden">
            <SkeletonBar className="size-4" />
            <SkeletonBar className="h-4 w-24" />
          </div>
          <div className="space-y-1 max-md:hidden">
            <SkeletonBar className="h-4 w-16" />
            <SkeletonBar className="h-3 w-32" />
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-3">
            <SkeletonBar className="size-10 shrink-0 rounded-full" />
            <div className="space-y-1.5">
              <SkeletonBar className="h-4 w-36" />
              <SkeletonBar className="h-3 w-24" />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <SkeletonBar className="h-4 w-full" />
            <SkeletonBar className="h-4 w-5/6" />
            <SkeletonBar className="h-4 w-2/3" />
          </div>

          <div className="mt-4 flex gap-6 border-t pt-3">
            <SkeletonBar className="h-5 w-12" />
            <SkeletonBar className="h-5 w-12" />
            <SkeletonBar className="h-5 w-12" />
          </div>
        </div>
      </div>
    </>
  )
}

export default StatusLoading
