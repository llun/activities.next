import { FC } from 'react'

export const StatusLoading: FC = () => {
  return (
    <div
      aria-busy="true"
      aria-label="Loading post"
      className="mt-4 overflow-hidden rounded-2xl border bg-background/80 shadow-sm"
    >
      <div className="flex items-center gap-3 border-b bg-background/90 px-5 py-3">
        <div className="skeleton h-8 w-8 rounded-md" />
        <div className="space-y-1">
          <div className="skeleton h-4 w-16 rounded" />
          <div className="skeleton h-3 w-32 rounded" />
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-center gap-3">
          <div className="skeleton size-12 shrink-0 rounded-full" />
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

        <div className="mt-6 flex gap-8 border-t pt-4">
          <div className="skeleton h-5 w-12 rounded" />
          <div className="skeleton h-5 w-12 rounded" />
          <div className="skeleton h-5 w-12 rounded" />
        </div>
      </div>
    </div>
  )
}

export default StatusLoading
