'use client'

import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  DraftConflictError,
  announceDraftsChanged,
  deleteDraftAndOwnedMedia,
  getDraft
} from '@/lib/client/drafts'
import { useCopyToClipboard } from '@/lib/hooks/useCopyToClipboard'

export const SAVED_NOTE_MS = 6_000

const NOTE_CLASS =
  'fixed right-5 bottom-5 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg'
const ACTION_CLASS =
  'rounded font-semibold text-primary-text hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const DismissButton = ({ onDismiss }: { onDismiss: () => void }) => (
  <button
    type="button"
    onClick={onDismiss}
    aria-label="Dismiss notification"
    className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
  >
    <X className="size-4" />
  </button>
)

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
      announceDraftsChanged(accountId, actorId, draftId)
      onDismiss()
    } catch (error) {
      setStatus(error instanceof DraftConflictError ? 'changed' : 'failed')
    }
  }

  return (
    <div role="status" aria-live="polite" className={NOTE_CLASS}>
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
          className={ACTION_CLASS}
        >
          Discard
        </button>
      )}
      <DismissButton onDismiss={onDismiss} />
    </div>
  )
}

/**
 * Shown instead when a closed reply or quote could not be kept (storage full
 * or blocked, or another tab changed the draft). The note is the only place
 * left that holds the text, so it stays until dismissed.
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
