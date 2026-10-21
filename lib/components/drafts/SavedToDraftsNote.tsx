'use client'

import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  DraftConflictError,
  deleteDraftAndOwnedMedia,
  getDraft,
  postDraftsMessage
} from '@/lib/client/drafts'

export const SAVED_NOTE_MS = 6_000

interface Props {
  draftId: string
  accountId: string
  actorId: string
  onDismiss: () => void
}

/**
 * Shown when a reply or quote that has text is closed: the text stays in
 * Drafts. Discard deletes the draft and any media only it uploaded. It hides
 * itself, so the Drafts page's Delete is never the only other way out.
 */
export function SavedToDraftsNote({
  draftId,
  accountId,
  actorId,
  onDismiss
}: Props) {
  const [status, setStatus] = useState<'failed' | 'changed' | null>(null)
  // The revision the note was shown for: a later one means another tab edited
  // the draft, and a stale Discard must not delete that newer text.
  const shownRevision = useRef<number | null>(null)

  useEffect(() => {
    shownRevision.current = null
    getDraft(draftId)
      .then((draft) => {
        shownRevision.current = draft?.revision ?? null
      })
      .catch(() => {})
  }, [draftId])

  useEffect(() => {
    const timer = setTimeout(onDismiss, SAVED_NOTE_MS)
    return () => clearTimeout(timer)
  }, [draftId, onDismiss])

  const discard = async () => {
    try {
      const draft = await getDraft(draftId)
      if (draft) {
        if (
          shownRevision.current !== null &&
          draft.revision !== shownRevision.current
        ) {
          setStatus('changed')
          return
        }
        await deleteDraftAndOwnedMedia(draft)
      }
      postDraftsMessage({ type: 'changed', accountId, actorId, draftId })
      onDismiss()
    } catch (error) {
      setStatus(error instanceof DraftConflictError ? 'changed' : 'failed')
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-5 bottom-5 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
    >
      <span className="font-medium">
        {status === 'failed'
          ? 'Couldn’t discard. Try again.'
          : status === 'changed'
            ? 'Changed in another tab'
            : 'Saved to Drafts'}
      </span>
      {status === 'changed' ? null : (
        <button
          type="button"
          onClick={() => void discard()}
          className="rounded font-semibold text-primary-text hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Discard
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
