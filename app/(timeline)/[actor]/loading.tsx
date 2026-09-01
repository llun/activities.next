import { FC } from 'react'

export const ProfileLoading: FC = () => {
  return (
    <div aria-busy="true" aria-label="Loading profile" className="space-y-6">
      <section className="overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
        <div className="skeleton relative h-36 md:h-52" />

        <div className="relative px-6 pb-6">
          <div className="skeleton relative -mt-10 h-20 w-20 rounded-full border-4 border-background" />

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="skeleton h-7 w-48 rounded-md" />
              <div className="skeleton h-4 w-32 rounded-md" />
            </div>
            <div className="skeleton h-9 w-28 rounded-md" />
          </div>

          <div className="mt-4 space-y-2">
            <div className="skeleton h-4 w-3/4 rounded" />
            <div className="skeleton h-4 w-1/2 rounded" />
          </div>

          <div className="mt-5 flex flex-wrap gap-6">
            <div className="skeleton h-4 w-16 rounded" />
            <div className="skeleton h-4 w-20 rounded" />
            <div className="skeleton h-4 w-20 rounded" />
          </div>
        </div>
      </section>

      <div className="space-y-4">
        <div className="flex gap-2">
          <div className="skeleton h-9 w-20 rounded-lg" />
          <div className="skeleton h-9 w-20 rounded-lg" />
          <div className="skeleton h-9 w-20 rounded-lg" />
        </div>

        <div className="divide-y overflow-hidden rounded-2xl border bg-background/80 shadow-sm">
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
