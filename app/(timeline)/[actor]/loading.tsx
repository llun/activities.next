import { FC } from 'react'

export const ProfileLoading: FC = () => {
  return (
    <div aria-busy="true" aria-label="Loading profile" className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <div className="relative h-36 animate-pulse bg-muted md:h-52" />

        <div className="relative px-6 pb-6">
          <div className="relative -mt-10 h-20 w-20 animate-pulse rounded-full border-4 border-background bg-muted" />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
              <div className="h-4 w-32 animate-pulse rounded-md bg-muted" />
            </div>
            <div className="h-9 w-28 animate-pulse rounded-md bg-muted" />
          </div>

          <div className="mt-4 space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          </div>

          <div className="mt-5 flex flex-wrap gap-6">
            <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </section>

      <div className="space-y-4">
        <div className="flex gap-2">
          <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 w-20 animate-pulse rounded-lg bg-muted" />
        </div>

        <div className="divide-y overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-3 p-4">
              <div className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                </div>
                <div className="space-y-1.5">
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                  <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
                </div>
                <div className="flex gap-6 pt-2">
                  <div className="h-4 w-8 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-8 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-8 animate-pulse rounded bg-muted" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ProfileLoading
