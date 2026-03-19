'use client'

import { RefreshCw } from 'lucide-react'
import { FC, useState } from 'react'

import { retryFitnessProcessing } from '@/lib/client'
import { cn } from '@/lib/utils'

interface Props {
  statusId: string
}

export const RetryFitnessButton: FC<Props> = ({ statusId }) => {
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryRequested, setRetryRequested] = useState(false)

  if (retryRequested) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <RefreshCw className="size-3 animate-spin" />
        Retrying...
      </span>
    )
  }

  return (
    <button
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium',
        'text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
        isRetrying && 'pointer-events-none opacity-50'
      )}
      disabled={isRetrying}
      onClick={async (e) => {
        e.stopPropagation()
        e.preventDefault()
        setIsRetrying(true)
        try {
          await retryFitnessProcessing(statusId)
          setRetryRequested(true)
        } catch {
          setIsRetrying(false)
        }
      }}
    >
      <RefreshCw className={cn('size-3', isRetrying && 'animate-spin')} />
      Retry
    </button>
  )
}
