'use client'

import { Loader2 } from 'lucide-react'
import { FC } from 'react'

import { Alert } from '@/lib/components/surface/Alert'
import { cn } from '@/lib/utils'

export const THREAD_LOAD_MORE_BUTTON_CLASS =
  'inline-flex rounded-sm text-xs font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-disabled:cursor-default aria-disabled:text-muted-foreground aria-disabled:no-underline'

export interface ThreadLoadMoreProps {
  label: string
  onLoad: () => void
  isLoading?: boolean
  /** The last load failed: the row shows an error with a Retry instead. */
  hasError?: boolean
  /** Layout of the row (borders, padding). */
  className?: string
}

/**
 * A thread's "Load earlier posts" / "Load more replies" row: the centred text
 * button the post page and the fitness activity page use for paging, which
 * shows a spinner while a load is on its way and turns into an error with a
 * Retry when it fails.
 */
export const ThreadLoadMore: FC<ThreadLoadMoreProps> = ({
  label,
  onLoad,
  isLoading = false,
  hasError = false,
  className
}) => (
  <div className={cn('px-4 py-3 text-center', className)}>
    {hasError ? (
      <Alert
        className="text-left"
        title="Couldn't load the conversation"
        onRetry={onLoad}
      >
        Check your connection and try again.
      </Alert>
    ) : (
      <button
        type="button"
        // Not `disabled`: a disabled button drops keyboard focus mid-load.
        onClick={isLoading ? undefined : onLoad}
        aria-disabled={isLoading || undefined}
        aria-busy={isLoading || undefined}
        className={THREAD_LOAD_MORE_BUTTON_CLASS}
      >
        <span className="inline-flex items-center gap-1.5">
          {isLoading ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : null}
          {label}
        </span>
      </button>
    )}
  </div>
)
