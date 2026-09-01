import { FC } from 'react'

interface FollowListLoadingSkeletonProps {
  label: string
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
      <div className="flex items-start gap-3">
        <div className="skeleton h-9 w-9 shrink-0 rounded-md" />
        <div className="space-y-1">
          <div className="skeleton h-7 w-32 rounded-md" />
          <div className="skeleton h-4 w-24 rounded" />
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
