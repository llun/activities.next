import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'

export const SearchLoading: FC = () => {
  return (
    <div aria-busy="true" aria-label="Loading search" className="space-y-6">
      <PageHeader
        title={<span className="skeleton block h-7 w-24 rounded-md" />}
        description={<span className="skeleton block h-4 w-48 rounded" />}
      />

      <section aria-label="Search form" className="flex gap-2">
        <div className="skeleton h-11 flex-1 rounded-md" />
        <div className="skeleton h-11 w-20 shrink-0 rounded-md" />
      </section>

      <section
        aria-label="Search tabs"
        className="grid h-auto w-full grid-cols-4 gap-1 rounded-lg bg-muted p-1"
      >
        <div className="skeleton h-8 rounded-md" />
        <div className="skeleton h-8 rounded-md" />
        <div className="skeleton h-8 rounded-md" />
        <div className="skeleton h-8 rounded-md" />
      </section>

      <section
        aria-label="Search results"
        className="divide-y divide-border/60 overflow-hidden rounded-lg border bg-background/80 shadow-sm"
      >
        <div className="flex items-start gap-3 p-4">
          <div className="skeleton size-11 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <div className="skeleton h-4 w-32 rounded" />
              <div className="skeleton h-3 w-24 rounded" />
            </div>
            <div className="skeleton h-3.5 w-4/5 rounded" />
          </div>
        </div>

        <div className="flex gap-3 px-4 py-3">
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

        <div className="flex items-center gap-3 p-4">
          <div className="skeleton size-10 shrink-0 rounded-full" />
          <div className="min-w-0 space-y-1.5">
            <div className="skeleton h-4 w-28 rounded" />
            <div className="skeleton h-3 w-16 rounded" />
          </div>
        </div>
      </section>
    </div>
  )
}

export default SearchLoading
