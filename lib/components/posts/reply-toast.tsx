'use client'

import { X } from 'lucide-react'
import { FC, useEffect } from 'react'

import { Status } from '@/lib/types/domain/status'

export interface ReplyToastProps {
  status: Status
  onDismiss: () => void
  onViewReply: (status: Status) => void
  duration?: number
}

export const ReplyToast: FC<ReplyToastProps> = ({
  status,
  onDismiss,
  onViewReply,
  duration = 6000
}) => {
  useEffect(() => {
    if (duration <= 0) return
    const timer = setTimeout(() => {
      onDismiss()
    }, duration)
    return () => clearTimeout(timer)
  }, [duration, onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
    >
      <span className="font-medium">Reply posted</span>
      <button
        type="button"
        onClick={() => onViewReply(status)}
        className="font-semibold text-primary hover:underline focus:outline-none"
      >
        View reply
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
