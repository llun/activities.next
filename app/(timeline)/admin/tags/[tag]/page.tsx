import { notFound, redirect } from 'next/navigation'

import { DetailList } from '@/lib/components/admin/DetailList'
import { Pagination } from '@/lib/components/admin/Pagination'
import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import { BackLink } from '@/lib/components/back-link'
import { PageHeader } from '@/lib/components/page-header'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { cleanJson } from '@/lib/utils/cleanJson'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { AdminHashtagPosts } from './AdminHashtagPosts'

export const dynamic = 'force-dynamic'

const ITEMS_PER_PAGE = 20

interface Props {
  params: Promise<{ tag: string }>
  searchParams: Promise<Record<string, string | undefined>>
}

const Page = async ({ params, searchParams }: Props) => {
  const { tag } = await params
  if (!tag || tag.length === 0) return notFound()

  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const offset = (page - 1) * ITEMS_PER_PAGE

  const { host } = getConfig()

  const { statuses, total } = await database.getHashtagStatusesPage({
    hashtag: tag,
    limit: ITEMS_PER_PAGE,
    offset
  })

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE)

  // Posts are newest first, so the first one on page 1 is the hashtag's latest;
  // on a later page it is only the newest of that page, and is labelled so.
  const newestCreatedAt = statuses[0]?.createdAt
  const facts = [
    { label: 'Public posts', value: total.toLocaleString() },
    ...(statuses.length > 0
      ? [
          {
            label: 'Showing',
            value: `${offset + 1}–${offset + statuses.length}`
          }
        ]
      : []),
    ...(typeof newestCreatedAt === 'number'
      ? [
          {
            label: page === 1 ? 'Latest post' : 'Newest on this page',
            value: getISOTimeUTC(newestCreatedAt, true)
          }
        ]
      : [])
  ]

  return (
    <div className="space-y-6">
      {/* Below md the Back is its own "Back" row above the heading; from md
          up it is the icon beside the heading it always was. */}
      <div className="flex items-start gap-3 max-md:flex-col max-md:gap-1">
        <BackLink
          href="/admin/tags"
          accessibleName="Back to hashtags list"
          iconOnlyFrom="md"
          className="md:rounded-lg md:p-2 md:hover:bg-muted"
        />
        <PageHeader
          className="flex-1"
          title={tag.replace(/^#+/, '')}
          description="Public posts that use this hashtag."
        />
      </div>

      <DetailList items={facts} />

      {statuses.length === 0 ? (
        <EmptyState
          icon={ADMIN_ICONS.tags}
          title={`No public posts with #${tag.replace(/^#+/, '')}`}
        >
          Public posts that use this hashtag are listed here.
        </EmptyState>
      ) : (
        <AdminHashtagPosts
          host={host}
          statuses={statuses.map((s) => cleanJson(s))}
          currentTime={Date.now()}
        />
      )}

      {totalPages > 1 && (
        <Pagination
          label={`Page ${page} of ${totalPages}`}
          previousHref={
            page > 1
              ? `/admin/tags/${encodeURIComponent(tag)}?page=${page - 1}`
              : undefined
          }
          nextHref={
            page < totalPages
              ? `/admin/tags/${encodeURIComponent(tag)}?page=${page + 1}`
              : undefined
          }
        />
      )}
    </div>
  )
}

export default Page
