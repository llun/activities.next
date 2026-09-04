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
import { FC, useState, useTransition } from 'react'

import {
  deleteSelectedDeadLetterJobs,
  discardDeadLetterJob,
  retryDeadLetterJob,
  retrySelectedDeadLetterJobs
} from '@/app/(timeline)/admin/queues/actions'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { Checkbox } from '@/lib/components/ui/checkbox'
import { DeadLetterJob } from '@/lib/types/database/operations'

interface Props {
  jobs: DeadLetterJob[]
}

export const AdminQueuesList: FC<Props> = ({ jobs }) => {
  const [expandedJobIds, setExpandedJobIds] = useState<Record<string, boolean>>(
    {}
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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
    setSelectedIds((prev) => {
      const next = new Set(prev)
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
      <div className="rounded-xl border bg-background/80 p-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">
          No dead-lettered jobs found.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background/50 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={allSelected}
            onChange={toggleSelectAll}
            aria-label="Select all jobs"
          />
          <span className="font-medium text-muted-foreground">
            {selectedIds.size > 0
              ? `${selectedIds.size} of ${jobs.length} selected`
              : 'Select all'}
          </span>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={handleRetrySelected}
              className="gap-1 text-xs"
            >
              <RotateCw className="h-3 w-3" />
              Retry selected ({selectedIds.size})
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={handleDeleteSelected}
              className="gap-1 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3 w-3" />
              Delete selected ({selectedIds.size})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-muted-foreground"
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {jobs.map((job) => {
        const isExpanded = !!expandedJobIds[job.id]
        const formattedPayload = JSON.stringify(job.payload, null, 2)
        const dateString = new Date(job.createdAt).toLocaleString()

        return (
          <div
            key={job.id}
            className="rounded-xl border bg-background/80 p-4 shadow-sm transition-colors"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <Checkbox
                  checked={selectedIds.has(job.id)}
                  onChange={() => toggleSelect(job.id)}
                  aria-label={`Select job ${job.jobName}`}
                  className="mt-1 shrink-0"
                />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm sm:text-base">
                      {job.jobName}
                    </span>
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
                    <span className="text-xs text-muted-foreground">
                      Attempts: {job.attempts}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dateString}
                    </span>
                  </div>
                  <p className="truncate text-sm text-destructive font-mono">
                    {job.errorMessage}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {job.status !== 'retried' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleRetry(job.id)}
                    className="gap-1 text-xs"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
                {job.status === 'failed' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleDiscard(job.id)}
                    className="gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    Discard
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleExpand(job.id)}
                  aria-label={
                    isExpanded ? 'Collapse job details' : 'Expand job details'
                  }
                  className="gap-1 text-xs"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-4 w-4" />
                      Less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" />
                      Details
                    </>
                  )}
                </Button>
              </div>
            </div>

            {isExpanded && (
              <div className="mt-4 space-y-4 border-t pt-4">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Payload
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        copyToClipboard(formattedPayload, `payload-${job.id}`)
                      }
                      className="h-7 gap-1 text-xs"
                    >
                      {copiedKey === `payload-${job.id}` ? (
                        <>
                          <Check className="h-3 w-3 text-green-600" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy JSON
                        </>
                      )}
                    </Button>
                  </div>
                  <pre className="max-h-60 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs text-foreground">
                    {formattedPayload}
                  </pre>
                </div>

                {job.errorStack && (
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Error Stack Trace
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          copyToClipboard(
                            job.errorStack ?? '',
                            `stack-${job.id}`
                          )
                        }
                        className="h-7 gap-1 text-xs"
                      >
                        {copiedKey === `stack-${job.id}` ? (
                          <>
                            <Check className="h-3 w-3 text-green-600" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy Stack
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="max-h-60 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs text-destructive">
                      {job.errorStack}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
