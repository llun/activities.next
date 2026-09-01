import { FC } from 'react'

export const FollowingLoading: FC = () => {
  return (
    <div aria-busy="true" aria-label="Loading following" className="space-y-6">
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

export default FollowingLoading
