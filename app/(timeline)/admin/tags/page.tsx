import { Hash } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Pagination } from '@/lib/components/admin/Pagination'
import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import { PageHeader } from '@/lib/components/page-header'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import {
  TABLE_CELL_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TableFrame
} from '@/lib/components/surface/TableFrame'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { HashtagSortOrder } from '@/lib/types/database/operations'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

export const dynamic = 'force-dynamic'

const ITEMS_PER_PAGE = 20

const HEAD_CELL_CLASS = 'px-3 py-2.5 font-medium'

const SORT_OPTIONS: { value: HashtagSortOrder; label: string }[] = [
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'recent', label: 'Recently active' },
  { value: 'count', label: 'Most posts' }
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
  const offset = Math.min((page - 1) * ITEMS_PER_PAGE, Number.MAX_SAFE_INTEGER)

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
      <PageHeader
        title="Hashtags"
        description={`${total} hashtag${total !== 1 ? 's' : ''} in the system.`}
      />

      <SegmentedControl
        asLinks
        aria-label="Sort hashtags"
        size="sm"
        items={SORT_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          href: buildHref({ sort: option.value, page: 1 })
        }))}
        value={sort}
      />

      {hashtags.length === 0 ? (
        <EmptyState icon={ADMIN_ICONS.tags} title="No hashtags found">
          Hashtags appear here once people use them in public posts.
        </EmptyState>
      ) : (
        <TableFrame aria-label="Hashtags">
          <thead>
            <tr className={TABLE_HEAD_ROW_CLASS}>
              <th scope="col" className={HEAD_CELL_CLASS}>
                Hashtag
              </th>
              <th scope="col" className={HEAD_CELL_CLASS}>
                Posts
              </th>
              <th scope="col" className={HEAD_CELL_CLASS}>
                Latest post
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {hashtags.map((hashtag) => (
              <tr key={hashtag.name} className="hover:bg-muted/60">
                <td className={`${TABLE_CELL_CLASS} max-w-64`}>
                  <Link
                    href={`/admin/tags/${encodeURIComponent(hashtag.name.replace(/^#/, ''))}`}
                    className="flex items-center gap-2 font-medium hover:underline"
                  >
                    <Hash
                      aria-hidden="true"
                      className="text-muted-foreground size-4 shrink-0"
                    />
                    <span className="truncate">
                      {hashtag.name.replace(/^#+/, '')}
                    </span>
                  </Link>
                </td>
                <td className={`${TABLE_CELL_CLASS} tabular-nums`}>
                  {hashtag.postCount}
                  <span className="sr-only">
                    {' '}
                    post{hashtag.postCount !== 1 ? 's' : ''}
                  </span>
                </td>
                <td
                  className={`${TABLE_CELL_CLASS} text-muted-foreground whitespace-nowrap`}
                >
                  {hashtag.latestPostAt != null
                    ? getISOTimeUTC(hashtag.latestPostAt, true)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}

      {totalPages > 1 && (
        <Pagination
          label={`Page ${page} of ${totalPages}`}
          previousHref={page > 1 ? buildHref({ page: page - 1 }) : undefined}
          nextHref={
            page < totalPages ? buildHref({ page: page + 1 }) : undefined
          }
        />
      )}
    </div>
  )
}

export default Page
