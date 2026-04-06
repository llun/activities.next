import { ChevronLeft, ChevronRight, Hash } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { HashtagSortOrder } from '@/lib/types/database/operations'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

export const dynamic = 'force-dynamic'

const ITEMS_PER_PAGE = 20

const SORT_OPTIONS: { value: HashtagSortOrder; label: string }[] = [
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'recent', label: 'Recently Active' },
  { value: 'count', label: 'Most Posts' }
]

interface Props {
  searchParams: Promise<Record<string, string | undefined>>
}

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const params = await searchParams
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const sort: HashtagSortOrder =
    params.sort === 'recent' || params.sort === 'count'
      ? params.sort
      : 'alphabetical'
  const offset = (page - 1) * ITEMS_PER_PAGE

  const { hashtags, total } = await database.getAllHashtags({
    limit: ITEMS_PER_PAGE,
    offset,
    sort
  })

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  const buildHref = (overrides: Record<string, string | number>) => {
    const qs = new URLSearchParams({
      sort,
      page: String(page),
      ...Object.fromEntries(
        Object.entries(overrides).map(([k, v]) => [k, String(v)])
      )
    })
    return `/admin/tags?${qs.toString()}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Hashtags</h1>
        <p className="text-sm text-muted-foreground">
          {total} hashtag{total !== 1 ? 's' : ''} in the system
        </p>
      </div>

      <div className="flex gap-2">
        {SORT_OPTIONS.map((option) => (
          <Link
            key={option.value}
            href={buildHref({ sort: option.value, page: 1 })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              sort === option.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
            }`}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {hashtags.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
          No hashtags found
        </div>
      ) : (
        <div className="space-y-2">
          {hashtags.map((hashtag) => (
            <Link
              key={hashtag.name}
              href={`/admin/tags/${hashtag.name}`}
              className="flex items-center justify-between rounded-xl border bg-background/80 p-4 shadow-sm transition-colors hover:bg-muted"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-medium truncate">{hashtag.name}</span>
              </div>
              <div className="flex items-center gap-4 ml-4 shrink-0 text-sm text-muted-foreground">
                <span>
                  {hashtag.postCount} post{hashtag.postCount !== 1 ? 's' : ''}
                </span>
                {hashtag.latestPostAt != null && (
                  <span className="hidden sm:inline">
                    {new Date(hashtag.latestPostAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Link
              href={buildHref({ page: page - 1 })}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Link>
          ) : (
            <span className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground/50">
              <ChevronLeft className="h-4 w-4" />
              Previous
            </span>
          )}
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={buildHref({ page: page + 1 })}
              className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground/50">
              Next
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default Page
