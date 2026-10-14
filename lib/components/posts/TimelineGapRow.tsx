'use client'

import { RefreshCw } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

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
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    setIsOffline(!navigator.onLine)
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

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
