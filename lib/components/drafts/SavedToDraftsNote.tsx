'use client'

import { useEffect, useState } from 'react'

import {
  DraftConflictError,
  announceDraftsChanged,
  deleteDraftAndOwnedMedia,
  getDraft
} from '@/lib/client/drafts'
import {
  ACTION_CLASS,
  DismissButton,
  NOTE_CLASS
} from '@/lib/components/drafts/NotSavedToDraftsNote'

export const SAVED_NOTE_MS = 6_000

interface Props {
  draftId: string
  /** The revision that was kept: a later one means another tab edited it. */
  revision: number
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
  revision,
  accountId,
  actorId,
  onDismiss
}: Props) {
  const [status, setStatus] = useState<'failed' | 'changed' | null>(null)

  useEffect(() => {
    const timer = setTimeout(onDismiss, SAVED_NOTE_MS)
    return () => clearTimeout(timer)
  }, [draftId, revision, onDismiss])

  const discard = async () => {
    try {
      const draft = await getDraft(draftId)
      if (draft) {
        // A stale Discard must not delete another tab's newer text.
        if (draft.revision !== revision) {
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
