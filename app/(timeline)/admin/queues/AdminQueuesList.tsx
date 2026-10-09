'use client'

import {
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  RotateCw,
  Trash2
} from 'lucide-react'
import { FC, Fragment, useMemo, useState, useTransition } from 'react'

import {
  deleteSelectedDeadLetterJobs,
  discardDeadLetterJob,
  retryDeadLetterJob,
  retrySelectedDeadLetterJobs
} from '@/app/(timeline)/admin/queues/actions'
import { ADMIN_ICONS } from '@/lib/components/admin/adminIcons'
import {
  PHONE_DETAIL_CLASS,
  SECONDARY_COLUMN_CLASS
} from '@/lib/components/admin/adminTable'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import {
  TABLE_HEAD_ROW_CLASS,
  TableFrame
} from '@/lib/components/surface/TableFrame'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import { DeadLetterJob } from '@/lib/types/database/operations'
import { cn } from '@/lib/utils'

interface Props {
  jobs: DeadLetterJob[]
}

const HEAD_CELL_CLASS = 'px-3 py-2.5 font-medium'

export const AdminQueuesList: FC<Props> = ({ jobs }) => {
  const [expandedJobIds, setExpandedJobIds] = useState<Record<string, boolean>>(
    {}
  )
  const [pickedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // The selection is only ever what is still listed: after a Refresh, or a
  // retry that moves a job out of this status, a picked job that is gone must
  // not stay counted ("1 of 0 selected") or be acted on unseen.
  const selectedIds = useMemo(() => {
    const listed = new Set(jobs.map((job) => job.id))
    return new Set([...pickedIds].filter((id) => listed.has(id)))
  }, [jobs, pickedIds])

  const allSelected =
    jobs.length > 0 && jobs.every((job) => selectedIds.has(job.id))

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(jobs.map((job) => job.id)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(() => {
      const next = new Set(selectedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleRetrySelected = () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    startTransition(async () => {
      await retrySelectedDeadLetterJobs(ids)
      setSelectedIds(new Set())
    })
  }

  const handleDeleteSelected = () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (
      !confirm(
        `Are you sure you want to delete ${ids.length} selected job${ids.length === 1 ? '' : 's'}?`
      )
    )
      return
    startTransition(async () => {
      await deleteSelectedDeadLetterJobs(ids)
      setSelectedIds(new Set())
    })
  }

  const toggleExpand = (id: string) => {
    setExpandedJobIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      // ignore
    }
  }

  const handleRetry = (id: string) => {
    startTransition(async () => {
      await retryDeadLetterJob(id)
    })
  }

  const handleDiscard = (id: string) => {
    startTransition(async () => {
      await discardDeadLetterJob(id)
    })
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        icon={ADMIN_ICONS.queues}
        title="No dead-lettered jobs found."
      >
        Background tasks that fail for good are kept here so you can retry them.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground text-sm font-medium">
          {selectedIds.size > 0
            ? `${selectedIds.size} of ${jobs.length} selected`
            : `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} on this page`}
        </span>

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={handleRetrySelected}
            >
              <RotateCw />
              Retry selected ({selectedIds.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={handleDeleteSelected}
              className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
            >
              <Trash2 />
              Delete selected ({selectedIds.size})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => setSelectedIds(new Set())}
              className="text-muted-foreground"
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      <TableFrame
        aria-label="Dead-lettered jobs"
        tableClassName="sm:min-w-[44rem]"
      >
        <thead>
          <tr className={TABLE_HEAD_ROW_CLASS}>
            <th scope="col" className="w-10 py-2.5 pl-4 pr-0 font-medium">
              <Checkbox
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={isPending}
                aria-label="Select all jobs"
              />
            </th>
            <th scope="col" className={HEAD_CELL_CLASS}>
              Job
            </th>
            <th
              scope="col"
              className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
            >
              Status
            </th>
            <th
              scope="col"
              className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
            >
              Attempts
            </th>
            <th
              scope="col"
              className={`${HEAD_CELL_CLASS} ${SECONDARY_COLUMN_CLASS}`}
            >
              Updated
            </th>
            <th scope="col" className={HEAD_CELL_CLASS}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {jobs.map((job) => {
            const isExpanded = !!expandedJobIds[job.id]
            const formattedPayload = JSON.stringify(job.payload, null, 2)
            const dateString = new Date(job.updatedAt).toLocaleString()
            const statusBadge = (
              <Badge
                tone={
                  job.status === 'failed'
                    ? 'destructive'
                    : job.status === 'retried'
                      ? 'success'
                      : 'gray'
                }
              >
                {job.status}
              </Badge>
            )

            return (
              <Fragment key={job.id}>
                <tr
                  className={cn(
                    'align-top hover:bg-muted/60',
                    isExpanded && 'bg-muted/40'
                  )}
                >
                  <td className="w-10 py-3 pl-4 pr-0">
                    <Checkbox
                      checked={selectedIds.has(job.id)}
                      onChange={() => toggleSelect(job.id)}
                      disabled={isPending}
                      aria-label={`Select job ${job.jobName} (${job.id})`}
                    />
                  </td>
                  <td className="w-full max-w-0 min-w-0 px-3 py-3 sm:w-auto sm:max-w-80">
                    <p className="font-semibold">{job.jobName}</p>
                    <p className="text-destructive-text truncate font-mono text-xs">
                      {job.errorMessage}
                    </p>
                    <div className={PHONE_DETAIL_CLASS}>
                      {statusBadge}
                      <span>
                        {job.attempts}{' '}
                        {job.attempts === 1 ? 'attempt' : 'attempts'}
                      </span>
                      <span>{dateString}</span>
                    </div>
                  </td>
                  <td className={`px-3 py-3 ${SECONDARY_COLUMN_CLASS}`}>
                    {statusBadge}
                  </td>
                  <td
                    className={`px-3 py-3 tabular-nums ${SECONDARY_COLUMN_CLASS}`}
                  >
                    {job.attempts}
                  </td>
                  <td
                    className={`text-muted-foreground px-3 py-3 whitespace-nowrap ${SECONDARY_COLUMN_CLASS}`}
                  >
                    {dateString}
                  </td>
                  <td className="px-2 py-3 sm:px-3">
                    <div className="flex items-center justify-end gap-1 sm:gap-2">
                      {job.status !== 'retried' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleRetry(job.id)}
                        >
                          <RotateCw />
                          <span className="max-sm:sr-only">Retry</span>
                        </Button>
                      )}
                      {job.status === 'failed' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleDiscard(job.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Ban />
                          <span className="max-sm:sr-only">Discard</span>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpand(job.id)}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <>
                            <ChevronUp />
                            <span>
                              <span className="max-sm:sr-only">Less</span>
                              <span className="sr-only">
                                {' '}
                                for {job.jobName}
                              </span>
                            </span>
                          </>
                        ) : (
                          <>
                            <ChevronDown />
                            <span>
                              <span className="max-sm:sr-only">Details</span>
                              <span className="sr-only">
                                {' '}
                                for {job.jobName}
                              </span>
                            </span>
                          </>
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-muted/40">
                    <td colSpan={6} className="px-4 pt-1 pb-4">
                      {/* `w-0 min-w-full`: the cell must not take its width from
                          the longest payload line, or the whole table widens and
                          every row's actions slide off-screen. The `pre` scrolls
                          inside the frame instead. */}
                      <div
                        data-slot="job-details"
                        className="w-0 min-w-full space-y-4"
                      >
                        <JobDetail
                          title="Payload"
                          copyLabel="Copy JSON"
                          copied={copiedKey === `payload-${job.id}`}
                          onCopy={() =>
                            copyToClipboard(
                              formattedPayload,
                              `payload-${job.id}`
                            )
                          }
                        >
                          {formattedPayload}
                        </JobDetail>

                        {job.errorStack && (
                          <JobDetail
                            title="Error stack trace"
                            copyLabel="Copy stack"
                            copied={copiedKey === `stack-${job.id}`}
                            onCopy={() =>
                              copyToClipboard(
                                job.errorStack ?? '',
                                `stack-${job.id}`
                              )
                            }
                            destructive
                          >
                            {job.errorStack}
                          </JobDetail>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </TableFrame>
    </div>
  )
}

const JobDetail: FC<{
  title: string
  copyLabel: string
  copied: boolean
  onCopy: () => void
  destructive?: boolean
  children: string
}> = ({ title, copyLabel, copied, onCopy, destructive, children }) => (
  <div>
    <div className="mb-1 flex items-center justify-between">
      <span className="text-muted-foreground text-xs font-semibold">
        {title}
      </span>
      <Button variant="ghost" size="sm" onClick={onCopy} className="h-7">
        {copied ? (
          <>
            <Check className="text-success-text" />
            Copied
          </>
        ) : (
          <>
            <Copy />
            {copyLabel}
          </>
        )}
      </Button>
    </div>
    <pre
      className={cn(
        'bg-background max-h-60 overflow-auto rounded-md border p-3 font-mono text-xs',
        destructive ? 'text-destructive-text' : 'text-foreground'
      )}
    >
      {children}
    </pre>
  </div>
)
