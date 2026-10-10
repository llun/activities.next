'use client'

import { Loader2 } from 'lucide-react'
import { FC, useState } from 'react'

import { deleteUnpostedMedia } from '@/lib/client'
import { Alert } from '@/lib/components/surface/Alert'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'

interface Props {
  /** The photos to delete: ones added in Gallery that no post uses. */
  mediaIds: string[]
  onCancel: () => void
  /**
   * The photos that are gone. Called once, with the ones deleted, when every
   * delete has settled and none failed.
   */
  onDeleted: (mediaIds: string[]) => void
  /** Some deletes failed: the ids that did go, so the page can drop them. */
  onPartlyDeleted?: (mediaIds: string[]) => void
  /** Where focus goes once the dialog has closed (`preventDefault` to take over). */
  onCloseAutoFocus?: (event: Event) => void
}

/**
 * The in-page confirmation before photos added in Gallery are deleted. The
 * delete is permanent (the media, its album places and its files), so it asks
 * first, with a count. A photo a post uses is refused by the server, so this can
 * never take a photo out of a post.
 */
export const ConfirmDeleteMediaDialog: FC<Props> = ({
  mediaIds,
  onCancel,
  onDeleted,
  onPartlyDeleted,
  onCloseAutoFocus
}) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = mediaIds.length
  const noun = count === 1 ? 'photo' : 'photos'

  const confirm = async () => {
    setBusy(true)
    setError(null)
    const results = await Promise.allSettled(
      mediaIds.map((id) => deleteUnpostedMedia(id))
    )
    const gone = mediaIds.filter((_, i) => results[i].status === 'fulfilled')
    const firstFailure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )
    if (!firstFailure) {
      onDeleted(gone)
      return
    }
    setBusy(false)
    if (gone.length > 0) onPartlyDeleted?.(gone)
    const reason =
      firstFailure.reason instanceof Error && firstFailure.reason.message
        ? firstFailure.reason.message
        : 'Failed to delete.'
    setError(
      gone.length > 0 ? `Deleted ${gone.length} of ${count}. ${reason}` : reason
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel()
      }}
    >
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>
            Delete {count} {noun}?
          </DialogTitle>
          <DialogDescription>
            This can’t be undone. {count === 1 ? 'It is' : 'They are'} removed
            from your gallery and albums, and the files are deleted.
          </DialogDescription>
        </DialogHeader>
        {error ? <Alert title={error} /> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : null}
            Delete {count} {noun}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
