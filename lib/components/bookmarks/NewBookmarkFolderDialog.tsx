'use client'

import { Loader2 } from 'lucide-react'
import { FC, FormEvent, useEffect, useId, useState } from 'react'

import { createBookmarkFolder } from '@/lib/client'
import { putBookmarkFolder } from '@/lib/components/bookmarks/bookmarkFolderStore'
import { Alert } from '@/lib/components/surface/Alert'
import { FormRow } from '@/lib/components/surface/FormRow'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import type { BookmarkFolderEntity } from '@/lib/services/bookmarks/bookmarkFolders'
import { MAX_BOOKMARK_FOLDER_NAME_LENGTH } from '@/lib/types/domain/bookmark'

export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The folder exists now; the caller files the post into it. */
  onCreated: (folder: BookmarkFolderEntity) => Promise<void> | void
}

/** The ⋯ menu's "New folder…": names a folder, creates it and files the post. */
export const NewBookmarkFolderDialog: FC<Props> = ({
  open,
  onOpenChange,
  onCreated
}) => {
  const inputId = useId()
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setError(null)
    }
  }, [open])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || !name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const folder = await createBookmarkFolder(name.trim())
      putBookmarkFolder(folder)
      await onCreated(folder)
      onOpenChange(false)
    } catch (caught) {
      setError(errorMessage(caught, "Couldn't create the folder."))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => void onSubmit(event)} className="contents">
          <DialogHeader>
            <DialogTitle>New bookmark folder</DialogTitle>
            <DialogDescription>
              The post is bookmarked and filed in the new folder. Only you can
              see your folders.
            </DialogDescription>
          </DialogHeader>
          <FormRow stacked className="p-0" label="Name" htmlFor={inputId}>
            <Input
              id={inputId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={MAX_BOOKMARK_FOLDER_NAME_LENGTH}
              autoComplete="off"
              autoFocus
            />
          </FormRow>
          {error ? <Alert title={error} /> : null}
          <DialogFooter separated>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
