import { FC } from 'react'

export const StatusLoading: FC = () => {
  return (
    <div
      aria-busy="true"
      aria-label="Loading post"
      className="mt-4 overflow-hidden rounded-2xl border bg-background/80 shadow-sm"
    >
      <div className="flex items-center gap-3 border-b bg-background/90 px-5 py-3">
        <div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
        <div className="space-y-1">
          <div className="h-4 w-16 animate-pulse rounded bg-muted" />
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-center gap-3">
          <div className="size-12 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="space-y-1.5">
            <div className="h-4 w-36 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>

        <div className="mt-6 flex gap-8 border-t pt-4">
          <div className="h-5 w-12 animate-pulse rounded bg-muted" />
          <div className="h-5 w-12 animate-pulse rounded bg-muted" />
          <div className="h-5 w-12 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}

export default StatusLoading
