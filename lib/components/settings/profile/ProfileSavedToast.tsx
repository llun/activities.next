'use client'

import { Check, X } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

interface Props {
  /** A new id starts the wait again (a second save while it is showing). */
  id: number
  onDismiss: () => void
  durationMs?: number
}

export const PROFILE_SAVED_TOAST_DURATION_MS = 8_000

export const PROFILE_SAVED_TITLE = 'Profile saved'
export const PROFILE_SAVED_MESSAGE =
  'Servers that follow you will show the change within a few minutes.'

/**
 * The message that floats at the bottom of the page after a save, in the
 * shape of `GalleryAddedToast`. It has no live region of its own, because one
 * that mounts with its text is often not announced: the editor keeps a polite
 * region mounted and puts the same words in it. The toast waits while the
 * pointer or focus is on it.
 */
export const ProfileSavedToast: FC<Props> = ({
  id,
  onDismiss,
  durationMs = PROFILE_SAVED_TOAST_DURATION_MS
}) => {
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || durationMs <= 0) return
    const timer = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timer)
  }, [id, paused, durationMs, onDismiss])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] z-40 flex justify-center px-4">
      <div
        data-testid="profile-saved-toast"
        className="bg-popover text-popover-foreground pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <Check
          className="text-success-text mt-0.5 size-4 shrink-0"
          aria-hidden="true"
        />
        <span className="min-w-0 break-words">
          <b className="block font-semibold">{PROFILE_SAVED_TITLE}</b>
          <span className="text-muted-foreground">{PROFILE_SAVED_MESSAGE}</span>
        </span>
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
