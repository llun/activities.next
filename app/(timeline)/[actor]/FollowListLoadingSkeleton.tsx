import { FC } from 'react'

import {
  MOBILE_BACK_ROW_CLASS,
  breakoutStyle
} from '@/lib/components/layout/chromeLayout'
import { PageHeader } from '@/lib/components/page-header'
import { Frame } from '@/lib/components/surface/Frame'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { cn } from '@/lib/utils'

interface FollowListLoadingSkeletonProps {
  label: string
  route: 'followers' | 'following'
}

// The signed-in page's labelled Back row below `md`: a 44px row with the arrow
// and the label.
const MobileBackRowSkeleton: FC<{ className?: string }> = ({ className }) => (
  <div className={cn('flex items-center', MOBILE_BACK_ROW_CLASS, className)}>
    <div className="skeleton size-5 shrink-0 rounded-md max-md:size-4" />
    <div className="skeleton h-4 w-28 rounded md:hidden" />
  </div>
)

/**
 * Shared skeleton for the followers/following loading states — the two
 * differ only in their `aria-label` and page title. `followers/loading.tsx`
 * and `following/loading.tsx` are thin default-export wrappers around this
 * component, each passing their own `label` and `route`: Next.js requires
 * every `loading.tsx` to default-export a no-arg component, so the wrapper
 * shape is required rather than importing this component directly as the
 * route's loading state.
 *
 * Signed in, below `md` it mirrors `FollowListPage`: the compact bar names the
 * page with the same plain title, and the content starts with the Back row, so
 * nothing shifts when the list arrives. Logged out it is the public header it
 * always was.
 */
export const FollowListLoadingSkeleton: FC<FollowListLoadingSkeletonProps> = ({
  label,
  route
}) => {
  const title = route === 'followers' ? 'Followers' : 'Following'

  return (
    <div aria-busy="true" data-route={route} className="space-y-6">
      <span role="status" className="sr-only">
        {label}
      </span>
      {/* Signed-in header: reuses PageHeader directly for pixel-exact
          alignment. `compactTitle` gives the mobile bar the loaded page's plain
          title while the desktop h1 keeps its skeleton; the box is the desktop
          header only, and the block below stands in for it under `md`. */}
      <PageHeader
        className="max-md:hidden group-data-[shell=public]/shell:hidden"
        compactTitle={title}
        title={
          <span className="flex items-center gap-2">
            <span className="skeleton size-5 shrink-0 rounded-md" />
            <span className="skeleton block h-7 w-28 rounded-md" />
          </span>
        }
        description={<span className="skeleton block h-4 w-24 rounded" />}
      />

      {/* Signed-in, below `md`: the loaded PageHeader box under the bar — a
          `pt-2` row of Back, then the count on its flush 20px `text-sm` line. */}
      <div
        className="md:hidden group-data-[shell=public]/shell:hidden"
        style={breakoutStyle}
      >
        <div className="mx-auto max-w-content px-4 pb-4 pt-2">
          <MobileBackRowSkeleton />
          <div className="skeleton h-5 w-24 rounded" />
        </div>
      </div>

      {/* Anonymous header: mirrors the non-sticky header inside PublicShell */}
      <div className="hidden items-start gap-2 group-data-[shell=public]/shell:flex">
        <div className="skeleton mt-0.5 size-5 shrink-0 rounded-md" />
        <div className="space-y-1">
          <div className="skeleton h-7 w-28 rounded-md" />
          <div className="skeleton h-4 w-24 rounded" />
        </div>
      </div>

      <Frame divided className="overflow-hidden">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-4">
            <SkeletonBar className="size-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <SkeletonBar className="h-4 w-36" />
              <SkeletonBar className="h-3 w-28" />
              <SkeletonBar className="h-3 w-48 max-w-full" />
            </div>
            <SkeletonBar className="h-8 w-20 shrink-0" />
          </div>
        ))}
      </Frame>
    </div>
  )
}
