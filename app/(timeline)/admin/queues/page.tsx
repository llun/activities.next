import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { getDLQProvider } from '@/lib/services/queue/dlq'
import { DeadLetterJobStatus } from '@/lib/types/database/operations'
import { cn } from '@/lib/utils'
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
        title="Queues & Dead Letter Queue"
        description="Inspect terminally failed background tasks, inspect payloads and stack traces, and trigger retries."
      />

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Queue Backend:</span>
        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">
          {provider.type === 'qstash'
            ? 'Upstash QStash (Native DLQ)'
            : 'Cloud Tasks (Database DLQ)'}
        </span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const isActive = activeStatus === tab.status
            return (
              <Link
                key={tab.label}
                href={buildHref({ status: tab.status, page: 1 })}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted/80 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.2 text-[10px]',
                    isActive
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-background/80 text-foreground'
                  )}
                >
                  {tab.count}
                </span>
              </Link>
            )
          })}
        </div>

        <AdminQueuesToolbar
          failedCount={counts.failed}
          discardedCount={counts.discarded}
        />
      </div>

      <AdminQueuesList jobs={jobs} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages} ({totalCount} total jobs)
          </span>

          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={buildHref({ page: page - 1 })}>
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
            )}

            {page < totalPages ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={buildHref({ page: page + 1 })}>
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Page
