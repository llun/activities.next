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
        >
          <RotateCw />
          Retry all failed ({failedCount})
        </Button>
      )}
      {discardedCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleClearDiscarded}
          className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
        >
          <Trash2 />
          Clear discarded ({discardedCount})
        </Button>
      )}
      {allCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={handleDropAll}
          className="text-destructive-text hover:bg-destructive/10 hover:text-destructive-text"
        >
          <Trash2 />
          Drop all messages ({allCount})
        </Button>
      )}
    </div>
  )
}
