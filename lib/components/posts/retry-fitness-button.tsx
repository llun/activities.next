'use client'

import { RefreshCw } from 'lucide-react'
import { FC, useState } from 'react'

import { retryFitnessProcessing } from '@/lib/client'
import { cn } from '@/lib/utils'

interface Props {
  statusId: string
  // `failed`: the job threw and gave up. `stuck`: the file is still marked
  // `processing` long after its worker died mid-run. `map`: the activity
  // imported fine but its route map could not be rendered or stored — a
  // degraded success, so it reads as a note rather than an error. `map-stale`:
  // same, except the activity still has the map from an earlier run, so the
  // copy must not claim there is none — and that map may predate the privacy
  // location the owner just added, which is the reason they regenerated.
  // All are retriable; the copy differs so the owner sees why.
  variant?: 'failed' | 'stuck' | 'map' | 'map-stale'
}

const LEAD_TEXT: Record<NonNullable<Props['variant']>, string> = {
  failed: 'Processing failed. The original activity file is still available.',
  stuck:
    'Processing is taking longer than expected. The original activity file is still available.',
  map: 'The route map image could not be generated. Everything else in this activity is intact.',
  'map-stale':
    'The route map image could not be updated, so this is the previous one. Everything else in this activity is intact.'
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
    <div
      className={cn(
        'mt-2 flex items-center gap-2',
        // A missing map is a degraded success, not a failed post — don't shout.
        variant === 'map' || variant === 'map-stale'
          ? 'text-muted-foreground'
          : 'text-destructive'
      )}
    >
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
