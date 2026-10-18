'use client'

import { Hash } from 'lucide-react'
import Link from 'next/link'
import { FC, useState } from 'react'

import { Pagination } from '@/lib/components/admin/Pagination'
import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { SectionSkeleton } from '@/lib/components/surface/SectionSkeleton'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import {
  TABLE_CELL_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TableFrame
} from '@/lib/components/surface/TableFrame'
import { AdminHashtag, HashtagSortOrder } from '@/lib/types/database/operations'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

const HEAD_CELL_CLASS = 'px-3 py-2.5 font-medium'

const SORT_OPTIONS: { value: HashtagSortOrder; label: string }[] = [
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'recent', label: 'Recently active' },
  { value: 'count', label: 'Most posts' }
]

interface Props {
  hashtags: AdminHashtag[]
  sort: HashtagSortOrder
  page: number
  totalPages: number
}

export const AdminHashtagsContent: FC<Props> = ({
  hashtags,
  sort,
  page,
  totalPages
}) => {
  const [pendingTarget, setPendingTarget] = useState<{
    sort: HashtagSortOrder
    page: number
  } | null>(null)
  const [prevProps, setPrevProps] = useState({ sort, page })

  if (prevProps.sort !== sort || prevProps.page !== page) {
    setPrevProps({ sort, page })
    setPendingTarget(null)
  }

  const isLoading =
    pendingTarget !== null &&
    (pendingTarget.sort !== sort || pendingTarget.page !== page)

  const activeSort = isLoading ? pendingTarget.sort : sort
  const activePage = isLoading ? pendingTarget.page : page

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
      <SegmentedControl
        asLinks
        aria-label="Sort hashtags"
        size="sm"
        items={SORT_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          href: buildHref({ sort: option.value, page: 1 })
        }))}
        value={activeSort}
        onValueChange={(nextSort) => {
          if (nextSort === sort && page === 1) {
            setPendingTarget(null)
          } else {
            setPendingTarget({
              sort: nextSort as HashtagSortOrder,
              page: 1
            })
          }
        }}
      />

      {isLoading ? (
        <SectionSkeleton
          title={false}
          sections={[6]}
          headings={false}
          label="Loading hashtags"
        />
      ) : hashtags.length === 0 ? (
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
          label={`Page ${activePage} of ${totalPages}`}
          previousHref={
            isLoading
              ? undefined
              : page > 1
                ? buildHref({ page: page - 1 })
                : undefined
          }
          nextHref={
            isLoading
              ? undefined
              : page < totalPages
                ? buildHref({ page: page + 1 })
                : undefined
          }
          onPreviousClick={() => {
            setPendingTarget({
              sort,
              page: page - 1
            })
          }}
          onNextClick={() => {
            setPendingTarget({
              sort,
              page: page + 1
            })
          }}
        />
      )}
    </div>
  )
}
