'use client'

import { RefreshCw } from 'lucide-react'
import { FC, useState } from 'react'

import { retryFitnessProcessing } from '@/lib/client'
import { cn } from '@/lib/utils'

interface Props {
  statusId: string
  // `failed`: the job threw and gave up. `stuck`: the file is still marked
  // `processing` long after its worker died mid-run. Both are retriable; the
  // copy differs so the owner sees why.
  variant?: 'failed' | 'stuck'
}

const LEAD_TEXT: Record<NonNullable<Props['variant']>, string> = {
  failed: 'Processing failed. The original activity file is still available.',
  stuck:
    'Processing is taking longer than expected. The original activity file is still available.'
}

export const RetryFitnessButton: FC<Props> = ({
  statusId,
  variant = 'failed'
}) => {
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryQueued, setRetryQueued] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (retryQueued) {
    return (
      <div className="mt-2 flex items-center gap-2 text-muted-foreground">
        <RefreshCw className="size-3" />
        <span>Retry queued. Processing will resume shortly.</span>
      </div>
    )
  }

  return (
    <div className="mt-2 flex items-center gap-2 text-destructive">
      <span>{LEAD_TEXT[variant]}</span>
      <span className="inline-flex flex-col gap-0.5">
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
            setError(null)
            try {
              await retryFitnessProcessing(statusId)
              setRetryQueued(true)
            } catch {
              setIsRetrying(false)
              setError('Retry failed. Please try again.')
            }
          }}
        >
          <RefreshCw className={cn('size-3', isRetrying && 'animate-spin')} />
          Retry
        </button>
        {error && <span className="text-destructive text-xs">{error}</span>}
      </span>
    </div>
  )
}
