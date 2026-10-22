'use client'

import { X } from 'lucide-react'

import { useCopyToClipboard } from '@/lib/hooks/useCopyToClipboard'

export const NOTE_CLASS =
  'fixed right-5 bottom-5 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg'
export const ACTION_CLASS =
  'rounded font-semibold text-primary-text hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export const DismissButton = ({ onDismiss }: { onDismiss: () => void }) => (
  <button
    type="button"
    onClick={onDismiss}
    aria-label="Dismiss notification"
    className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
  >
    <X className="size-4" />
  </button>
)

/**
 * Shown instead when a closed reply or quote (or a send stopped because the
 * composer moved to another post) could not be kept: storage full or
 * blocked, a conflicted draft (another tab saved, locked or deleted it), a
 * sign-out in another tab, or a reopened draft whose bytes are still loading
 * (seeding). The note is the only place left that holds the text, so it stays
 * until dismissed. DraftsProvider imports
 * it statically (nothing here loads IndexedDB code), so it renders offline.
 */
export function NotSavedToDraftsNote({
  text,
  onDismiss
}: {
  text: string
  onDismiss: () => void
}) {
  const { copied, copy } = useCopyToClipboard()
  return (
    <div role="alert" className={NOTE_CLASS}>
      <span className="font-medium">Couldn’t save to Drafts</span>
      {text ? (
        <button
          type="button"
          onClick={() => void copy(text)}
          className={ACTION_CLASS}
        >
          {copied ? 'Copied' : 'Copy text'}
        </button>
      ) : null}
      <DismissButton onDismiss={onDismiss} />
    </div>
  )
}
