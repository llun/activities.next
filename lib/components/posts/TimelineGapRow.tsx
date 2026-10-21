'use client'

import { RefreshCw } from 'lucide-react'
import { FC } from 'react'

import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { cn } from '@/lib/utils'

export interface TimelineGapRowProps {
  segmentIndex: number
  isLoading?: boolean
  onLoadGap: (segmentIndex: number) => void
}

export const TimelineGapRow: FC<TimelineGapRowProps> = ({
  segmentIndex,
  isLoading = false,
  onLoadGap
}) => {
  // "Can't reach" stays enabled: the status slot has Retry for it.
  const isOffline = useConnectionStatus().state === 'offline'

  const isDisabled = isLoading || isOffline

  return (
    <div
      role="region"
      aria-label="Timeline gap"
      className="border-y border-dashed border-border bg-muted/30 px-4 py-3 text-center"
    >
      <button
        type="button"
        disabled={isDisabled}
        aria-busy={isLoading}
        onClick={() => onLoadGap(segmentIndex)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
      >
        <RefreshCw
          className={cn('size-3.5', isLoading && 'animate-spin')}
          aria-hidden="true"
        />
        <span>Load missing posts</span>
      </button>
    </div>
  )
}
