'use client'

import {
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  RotateCw
} from 'lucide-react'
import { FC, useState, useTransition } from 'react'

import {
  discardDeadLetterJob,
  retryDeadLetterJob
} from '@/app/(timeline)/admin/queues/actions'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import { DeadLetterJob } from '@/lib/types/database/operations'

interface Props {
  jobs: DeadLetterJob[]
}

export const AdminQueuesList: FC<Props> = ({ jobs }) => {
  const [expandedJobIds, setExpandedJobIds] = useState<Record<string, boolean>>(
    {}
  )
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

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
