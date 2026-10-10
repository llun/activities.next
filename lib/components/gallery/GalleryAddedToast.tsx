'use client'

import { Check, X } from 'lucide-react'
import { FC, useEffect, useId, useState } from 'react'

interface Props {
  /** A new id starts the wait again. */
  id: number
  message: string
  /**
   * The one action beside the message, e.g. "Post them". When it cannot be
   * taken, `disabled` shows why in `hint` (e.g. "Up to 4 per post").
   */
  action?: {
    label: string
    onSelect: () => void
    disabled?: boolean
    hint?: string
  }
  onDismiss: () => void
  durationMs?: number
}

export const GALLERY_ADDED_TOAST_DURATION_MS = 12_000

/**
 * The message that floats at the bottom of the page after photos were added
 * to the gallery: "N added to your gallery." with a "Post them" action. The
 * toast has no live region of its own: one that mounts with its text is often
 * not announced, so the page keeps a region mounted and puts the message (and
 * why the action is off) in it. The toast waits while the pointer or focus is
 * on it, so the action is never taken away mid-reach.
 */
export const GalleryAddedToast: FC<Props> = ({
  id,
  message,
  action,
  onDismiss,
  durationMs = GALLERY_ADDED_TOAST_DURATION_MS
}) => {
  const [paused, setPaused] = useState(false)
  const hintId = useId()

  useEffect(() => {
    if (paused || durationMs <= 0) return
    const timer = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timer)
  }, [id, paused, durationMs, onDismiss])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] z-40 flex justify-center px-4">
      <div
        data-testid="gallery-added-toast"
        className="bg-popover text-popover-foreground pointer-events-auto flex max-w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{message}</span>
        {action ? (
          <>
            <button
              type="button"
              disabled={action.disabled}
              aria-describedby={
                action.disabled && action.hint ? hintId : undefined
              }
              onClick={action.onSelect}
              className="text-primary-text focus-visible:ring-ring/50 min-h-6 shrink-0 rounded px-1 font-semibold outline-none hover:underline focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50 pointer-coarse:min-h-10"
            >
              {action.label}
            </button>
            {action.disabled && action.hint ? (
              <span id={hintId} className="text-muted-foreground shrink-0">
                {action.hint}
              </span>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mr-1 flex size-6 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-[3px] pointer-coarse:size-10"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
