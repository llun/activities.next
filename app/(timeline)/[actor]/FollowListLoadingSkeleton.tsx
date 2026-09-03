import { CSSProperties, FC } from 'react'

interface FollowListLoadingSkeletonProps {
  label: string
}

const breakoutStyle: CSSProperties = {
  marginLeft: 'calc(-50vw + 50% + var(--sidebar-w, 0px) / 2)',
  marginRight: 'calc(-50vw + 50% + var(--sidebar-w, 0px) / 2)'
}

/**
 * Shared skeleton for the followers/following loading states — the two
 * differ only in their `aria-label`. `followers/loading.tsx` and
 * `following/loading.tsx` are thin default-export wrappers around this
 * component, each passing their own `label`: Next.js requires every
 * `loading.tsx` to default-export a no-arg component, so the wrapper shape
 * is required rather than importing this component directly as the route's
 * loading state.
 */
export const FollowListLoadingSkeleton: FC<FollowListLoadingSkeletonProps> = ({
  label
}) => {
  return (
    <div aria-busy="true" aria-label={label} className="space-y-6">
      {/* Signed-in header: mirrors PageHeader (sticky top-0, breakout, py-4) */}
      <div
        className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur group-data-[shell=public]/shell:hidden"
        style={breakoutStyle}
      >
        <div className="mx-auto max-w-content px-4 py-4">
          <div className="flex items-start gap-2">
            <div className="skeleton mt-0.5 size-5 shrink-0 rounded-md" />
            <div className="space-y-1">
              <div className="skeleton h-6 w-28 rounded-md" />
              <div className="skeleton h-3.5 w-24 rounded" />
            </div>
          </div>
        </div>
      </div>

      {/* Anonymous header: mirrors the non-sticky header inside PublicShell */}
      <div className="hidden items-start gap-2 group-data-[shell=public]/shell:flex">
        <div className="skeleton mt-0.5 size-5 shrink-0 rounded-md" />
        <div className="space-y-1">
          <div className="skeleton h-6 w-28 rounded-md" />
          <div className="skeleton h-3.5 w-24 rounded" />
        </div>
      </div>

      <div className="divide-y overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-3 px-5 py-4">
            <div className="skeleton h-12 w-12 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="skeleton h-4 w-36 rounded" />
              <div className="skeleton h-3 w-28 rounded" />
              <div className="skeleton h-3 w-48 rounded" />
            </div>
            <div className="skeleton h-8 w-20 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}
