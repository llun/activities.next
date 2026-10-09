import { redirect } from 'next/navigation'

import { Pagination } from '@/lib/components/admin/Pagination'
import { PageHeader } from '@/lib/components/page-header'
import { PageRefreshButton } from '@/lib/components/page-refresh-button'
import { SegmentedControl } from '@/lib/components/surface/SegmentedControl'
import { Badge } from '@/lib/components/ui/badge'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getDLQProvider } from '@/lib/services/queue/dlq'
import { DeadLetterJobStatus } from '@/lib/types/database/operations'
import { getAdminFromSession } from '@/lib/utils/getAdminFromSession'

import { AdminQueuesList } from './AdminQueuesList'
import { AdminQueuesToolbar } from './AdminQueuesToolbar'

export const dynamic = 'force-dynamic'

const ITEMS_PER_PAGE = 20

interface Props {
  searchParams: Promise<Record<string, string | undefined>>
}

const VALID_STATUSES: DeadLetterJobStatus[] = ['failed', 'retried', 'discarded']

const Page = async ({ searchParams }: Props) => {
  const database = getDatabase()
  if (!database) throw new Error('Failed to load database')

  const session = await getServerAuthSession()
  const admin = await getAdminFromSession(database, session)
  if (!admin) return redirect('/')

  const params = await searchParams
  const statusParam = params.status
  const activeStatus: DeadLetterJobStatus | undefined =
    statusParam && VALID_STATUSES.includes(statusParam as DeadLetterJobStatus)
      ? (statusParam as DeadLetterJobStatus)
      : undefined

  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const offset = (page - 1) * ITEMS_PER_PAGE

  const provider = getDLQProvider()
  const {
    jobs,
    total: totalCount,
    counts
  } = await provider.getJobs({
    status: activeStatus,
    limit: ITEMS_PER_PAGE,
    offset
  })

  const totalPages = Math.max(1, Math.ceil(totalCount / ITEMS_PER_PAGE))

  const buildHref = (
    overrides: Record<string, string | number | undefined>
  ) => {
    const query = new URLSearchParams()
    const targetStatus = 'status' in overrides ? overrides.status : activeStatus
    const targetPage = 'page' in overrides ? overrides.page : page

    if (targetStatus) {
      query.set('status', String(targetStatus))
    }
    if (targetPage && Number(targetPage) > 1) {
      query.set('page', String(targetPage))
    }

    const qs = query.toString()
    return `/admin/queues${qs ? `?${qs}` : ''}`
  }

  const tabs: { label: string; status?: DeadLetterJobStatus; count: number }[] =
    provider.type === 'qstash'
      ? [
          { label: 'All', count: counts.all },
          { label: 'Failed', status: 'failed', count: counts.failed }
        ]
      : [
          { label: 'All', count: counts.all },
          { label: 'Failed', status: 'failed', count: counts.failed },
          { label: 'Retried', status: 'retried', count: counts.retried },
          { label: 'Discarded', status: 'discarded', count: counts.discarded }
        ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Queues & dead letter queue"
        description="Inspect terminally failed background tasks, inspect payloads and stack traces, and trigger retries."
      />

      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        <span>Queue backend</span>
        <Badge tone="gray">
          {provider.type === 'qstash'
            ? 'Upstash QStash (Native DLQ)'
            : 'Cloud Tasks (Database DLQ)'}
        </Badge>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SegmentedControl
            asLinks
            aria-label="Job status"
            size="sm"
            className="min-w-0"
            items={tabs.map((tab) => ({
              value: tab.status ?? 'all',
              href: buildHref({ status: tab.status, page: 1 }),
              label: (
                <>
                  {tab.label}
                  <span className="text-xs tabular-nums opacity-70">
                    {tab.count}
                  </span>
                </>
              )
            }))}
            value={activeStatus ?? 'all'}
          />
          <PageRefreshButton accessibleName="Refresh queues" />
        </div>

        <AdminQueuesToolbar
          allCount={counts.all}
          failedCount={counts.failed}
          discardedCount={counts.discarded}
        />
      </div>

      <AdminQueuesList key={`${activeStatus ?? 'all'}-${page}`} jobs={jobs} />

      {totalPages > 1 && (
        <Pagination
          label={`Page ${page} of ${totalPages} (${totalCount} total jobs)`}
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
