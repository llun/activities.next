import { CSSProperties, FC } from 'react'

const breakoutStyle: CSSProperties = {
  marginLeft: 'calc(-50vw + 50% + var(--sidebar-w, 0px) / 2)',
  marginRight: 'calc(-50vw + 50% + var(--sidebar-w, 0px) / 2)'
}

export const MessagesLoading: FC = () => {
  return (
    <div
      aria-busy="true"
      aria-label="Loading messages"
      className="flex min-h-0 flex-1 flex-col gap-5 md:gap-6"
    >
      <div
        className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur"
        style={breakoutStyle}
      >
        <div className="mx-auto max-w-content px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="skeleton h-6 w-28 rounded-md" />
              <div className="skeleton h-3.5 w-60 rounded" />
            </div>
            <div className="skeleton h-8 w-18 rounded-md" />
          </div>
        </div>
      </div>

      <section
        aria-label="Direct messages"
        className="grid min-w-0 flex-1 overflow-hidden rounded-xl border bg-background shadow-sm md:min-h-0 md:grid-cols-[minmax(260px,34%)_minmax(0,1fr)] lg:grid-cols-[minmax(320px,30%)_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]"
      >
        <aside
          aria-label="Conversation list"
          className="min-w-0 border-b max-md:hidden md:min-h-0 md:border-b-0 md:border-r"
        >
          <div className="divide-y md:h-full md:overflow-y-auto">
            {[0, 1, 2, 3, 4].map((index) => (
              <div
                key={index}
                className="flex w-full items-start gap-3 border-b px-3 py-3 last:border-b-0 md:px-4 md:py-4"
              >
                <div className="skeleton mt-0.5 size-9 shrink-0 rounded-full md:size-11" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="skeleton h-4 w-28 rounded md:h-5 md:w-36" />
                    <div className="skeleton h-3 w-12 rounded" />
                  </div>
                  <div className="skeleton h-3.5 w-4/5 rounded" />
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div
          aria-label="Conversation thread"
          className="flex min-h-[60svh] min-w-0 flex-col md:min-h-0"
        >
          <div className="flex min-h-14 items-center justify-between gap-3 border-b px-4 md:min-h-16 md:px-5">
            <div className="skeleton size-8 shrink-0 rounded-md md:hidden" />
            <div className="skeleton size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="skeleton h-4 w-32 rounded md:h-5 md:w-40" />
              <div className="skeleton h-3 w-20 rounded md:w-28" />
            </div>
            <div className="skeleton size-8 shrink-0 rounded-md" />
          </div>

          <div
            aria-label="Message thread"
            className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-6"
          >
            <div className="flex items-end justify-start gap-2">
              <div className="skeleton size-7 shrink-0 rounded-full" />
              <div className="flex max-w-[78%] flex-col items-start gap-1">
                <div className="skeleton h-12 w-48 rounded-2xl rounded-bl-md md:w-64" />
                <div className="skeleton h-2.5 w-12 rounded" />
              </div>
            </div>

            <div className="flex items-end justify-end gap-2">
              <div className="flex max-w-[78%] flex-col items-end gap-1">
                <div className="skeleton h-16 w-56 rounded-2xl rounded-br-md md:w-72" />
                <div className="skeleton h-2.5 w-12 rounded" />
              </div>
            </div>

            <div className="flex items-end justify-start gap-2">
              <div className="skeleton size-7 shrink-0 rounded-full" />
              <div className="flex max-w-[78%] flex-col items-start gap-1">
                <div className="skeleton h-20 w-60 rounded-2xl rounded-bl-md md:w-80" />
                <div className="skeleton h-2.5 w-12 rounded" />
              </div>
            </div>

            <div className="flex items-end justify-end gap-2">
              <div className="flex max-w-[78%] flex-col items-end gap-1">
                <div className="skeleton h-10 w-36 rounded-2xl rounded-br-md md:w-48" />
                <div className="skeleton h-2.5 w-12 rounded" />
              </div>
            </div>
          </div>

          <div className="border-t p-4 md:p-5">
            <div className="flex items-end gap-2">
              <div className="skeleton h-10 flex-1 rounded-md" />
              <div className="skeleton h-10 w-20 shrink-0 rounded-md" />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default MessagesLoading
