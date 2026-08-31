import { FC } from 'react'

export const FollowingLoading: FC = () => {
  return (
    <div aria-busy="true" aria-label="Loading following" className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 shrink-0 animate-pulse rounded-md bg-muted" />
        <div className="space-y-1">
          <div className="h-7 w-32 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        </div>
      </div>

      <div className="divide-y overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-3 px-5 py-4">
            <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-muted" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-4 w-36 animate-pulse rounded bg-muted" />
              <div className="h-3 w-28 animate-pulse rounded bg-muted" />
              <div className="h-3 w-48 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-8 w-20 shrink-0 animate-pulse rounded-md bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default FollowingLoading
