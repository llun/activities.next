import { CSSProperties, FC } from 'react'

const breakoutStyle: CSSProperties = {
  marginLeft: 'calc(-50vw + 50% + var(--sidebar-w, 0px) / 2)',
  marginRight: 'calc(-50vw + 50% + var(--sidebar-w, 0px) / 2)'
}

export const TimelineLoading: FC = () => {
  return (
    <div aria-busy="true" aria-label="Loading timeline" className="space-y-6">
      <div
        className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur"
        style={breakoutStyle}
      >
        <div className="mx-auto max-w-content px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="skeleton h-6 w-24 rounded-md" />
              <div className="skeleton h-3.5 w-48 rounded" />
            </div>
            <div className="skeleton size-9 shrink-0 rounded-md" />
          </div>
        </div>
      </div>

      <section
        aria-label="Post composer"
        className="rounded-xl border bg-card p-4 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <div className="skeleton size-12 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="skeleton h-16 w-full rounded-md" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-1">
            <div className="skeleton size-8 rounded-md" />
            <div className="skeleton size-8 rounded-md" />
            <div className="skeleton size-8 rounded-md" />
            <div className="skeleton size-8 rounded-md" />
            <div className="skeleton size-8 rounded-md" />
            <div className="skeleton size-8 rounded-md" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="skeleton h-4 w-8 rounded" />
            <div className="skeleton h-8 w-16 rounded-md" />
          </div>
        </div>
      </section>

      <section
        aria-label="Timeline posts"
        className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm"
      >
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex gap-3 p-4">
            <div className="skeleton size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <div className="skeleton h-4 w-32 rounded" />
                <div className="skeleton h-3 w-20 rounded" />
              </div>
              <div className="space-y-1.5">
                <div className="skeleton h-4 w-full rounded" />
                <div className="skeleton h-4 w-4/5 rounded" />
              </div>
              <div className="flex gap-6 pt-2">
                <div className="skeleton h-4 w-8 rounded" />
                <div className="skeleton h-4 w-8 rounded" />
                <div className="skeleton h-4 w-8 rounded" />
                <div className="skeleton h-4 w-8 rounded" />
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

export default TimelineLoading
