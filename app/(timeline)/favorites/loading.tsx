import { FC } from 'react'

import { PageHeader } from '@/lib/components/page-header'

export const FavoritesLoading: FC = () => {
  return (
    <div aria-busy="true" aria-label="Loading favorites" className="space-y-6">
      <PageHeader
        title={<span className="skeleton block h-7 w-24 rounded-md" />}
        description={<span className="skeleton block h-4 w-48 rounded" />}
      />

      <section
        aria-label="Favorite posts"
        className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm"
      >
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex gap-3 px-4 py-3">
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

export default FavoritesLoading
