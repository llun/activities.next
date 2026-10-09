'use client'

import { Check, X } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import {
  ALBUM_TOAST_DURATION_MS,
  type AlbumToast
} from '@/lib/components/gallery/useMediaAlbums'
import { cn } from '@/lib/utils'

interface Props {
  toast: AlbumToast
  onDismiss: () => void
  durationMs?: number
  /** `dark` for a toast over the lightbox, whose backdrop is dark in both themes. */
  tone?: 'default' | 'dark'
  className?: string
}

/**
 * The "Added to …  Undo" message. It sits in the flow of the control that
 * raised it rather than floating over the page, so it stays inside a modal's
 * focus scope and a keyboard user can reach Undo; it is not a live region
 * itself (the control's always-present one reads the message), and it waits
 * while the pointer or focus is on it, so Undo is never taken away mid-reach.
 */
export const AlbumUndoToast: FC<Props> = ({
  toast,
  onDismiss,
  durationMs = ALBUM_TOAST_DURATION_MS,
  tone = 'default',
  className
}) => {
  const [paused, setPaused] = useState(false)
  // Undo is one-shot: once pressed the button stays (so focus is not dropped)
  // but does nothing until the next message replaces this one.
  const [undone, setUndone] = useState(false)

  useEffect(() => {
    setUndone(false)
  }, [toast.id])

  useEffect(() => {
    if (paused || durationMs <= 0) return
    const timer = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timer)
    // A new message (a new id) starts the wait again.
  }, [toast.id, paused, durationMs, onDismiss])

  return (
    <div
      data-testid="album-toast"
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-md',
        tone === 'dark'
          ? 'border-white/15 bg-neutral-800 text-neutral-50'
          : 'bg-popover text-popover-foreground',
        className
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Check
        className={cn(
          'size-4 shrink-0',
          tone === 'dark' ? 'text-orange-400' : 'text-primary'
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {toast.undo ? (
        <button
          type="button"
          aria-disabled={undone || undefined}
          onClick={() => {
            if (undone) return
            setUndone(true)
            toast.undo?.()
          }}
          className={cn(
            'focus-visible:ring-ring/50 relative min-h-6 rounded px-1 font-semibold outline-none hover:underline focus-visible:ring-[3px] aria-disabled:opacity-50 pointer-coarse:min-h-10 pointer-coarse:min-w-10',
            tone === 'dark' ? 'text-orange-300' : 'text-primary-text'
          )}
        >
          Undo
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className={cn(
          'focus-visible:ring-ring/50 -mr-1 flex size-6 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-[3px] pointer-coarse:size-10',
          tone === 'dark'
            ? 'text-neutral-400 hover:text-white'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
