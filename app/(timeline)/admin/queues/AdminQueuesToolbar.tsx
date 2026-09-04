'use client'

import { RotateCw, Trash2 } from 'lucide-react'
import { FC, useTransition } from 'react'

import {
  clearDiscardedJobs,
  dropAllDeadLetterJobs,
  retryAllDeadLetterJobs
} from '@/app/(timeline)/admin/queues/actions'
import { Button } from '@/lib/components/ui/button'

interface Props {
  allCount?: number
  failedCount: number
  discardedCount: number
}

export const AdminQueuesToolbar: FC<Props> = ({
  allCount = 0,
  failedCount,
  discardedCount
}) => {
  const [isPending, startTransition] = useTransition()

  const handleRetryAll = () => {
    if (!confirm('Are you sure you want to retry all failed jobs?')) return
    startTransition(async () => {
      await retryAllDeadLetterJobs()
    })
  }

  const handleClearDiscarded = () => {
    if (
      !confirm(
        'Are you sure you want to permanently delete all discarded jobs?'
      )
    )
      return
    startTransition(async () => {
      await clearDiscardedJobs()
    })
  }

  const handleDropAll = () => {
    if (
      !confirm(
        'Are you sure you want to permanently drop all messages in the dead letter queue?'
      )
    )
      return
    startTransition(async () => {
      await dropAllDeadLetterJobs()
    })
  }

  if (failedCount === 0 && discardedCount === 0 && allCount === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {failedCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleRetryAll}
          className="gap-1.5 text-xs"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Retry all failed ({failedCount})
        </Button>
      )}
      {discardedCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleClearDiscarded}
          className="gap-1.5 text-xs text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear discarded ({discardedCount})
        </Button>
      )}
      {allCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleDropAll}
          className="gap-1.5 text-xs text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Drop all messages ({allCount})
        </Button>
      )}
    </div>
  )
}
