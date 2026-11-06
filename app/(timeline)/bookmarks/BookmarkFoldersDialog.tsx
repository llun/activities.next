'use client'

import { Folder, Pencil, Trash2 } from 'lucide-react'
import { FC, FormEvent, useEffect, useRef, useState } from 'react'

import {
  createBookmarkFolder,
  deleteBookmarkFolder,
  renameBookmarkFolder
} from '@/lib/client'
import {
  putBookmarkFolder,
  removeBookmarkFolder
} from '@/lib/components/bookmarks/bookmarkFolderStore'
import { errorMessage } from '@/lib/components/bookmarks/errorMessage'
import { AddBar } from '@/lib/components/surface/AddBar'
import { Alert } from '@/lib/components/surface/Alert'
import { FramedList, FramedListItem } from '@/lib/components/surface/FramedList'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Input } from '@/lib/components/ui/input'
import type { BookmarkFolderEntity } from '@/lib/services/bookmarks/bookmarkFolders'
import { MAX_BOOKMARK_FOLDER_NAME_LENGTH } from '@/lib/types/domain/bookmark'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: BookmarkFolderEntity[]
  /**
   * A folder was deleted; `remaining` is how many are left. The page leaves
   * the folder if it was showing it.
   */
  onDeleted: (id: string, remaining: number) => void
}

type RowMode = { id: string; mode: 'rename' | 'delete' } | null

/**
 * "Manage folders": the AddBar creates a folder, and each row of the list
 * renames or deletes one. A delete asks first, in the row itself, and keeps
 * the folder's bookmarks.
 */
export const BookmarkFoldersDialog: FC<Props> = ({
  open,
  onOpenChange,
  folders,
  onDeleted
}) => {
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [rowMode, setRowMode] = useState<RowMode>(null)
  const [renameValue, setRenameValue] = useState('')
  const [rowError, setRowError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setNewName('')
      setAddError(null)
      setRowMode(null)
      setRowError(null)
    }
  }, [open])

  const onAdd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newName.trim()
    if (busy || !name) return
    setBusy(true)
    setAddError(null)
    try {
      putBookmarkFolder(await createBookmarkFolder(name))
      setNewName('')
    } catch (error) {
      setAddError(errorMessage(error, "Couldn't create the folder."))
    } finally {
      setBusy(false)
      // Create disables itself while saving, which drops focus to the page;
      // hand it back to the field for the next name.
      addInputRef.current?.focus()
    }
  }

  const startRow = (
    folder: BookmarkFolderEntity,
    mode: 'rename' | 'delete'
  ) => {
    setRowMode({ id: folder.id, mode })
    setRenameValue(folder.name)
    setRowError(null)
  }

  const onRename = async (event: FormEvent<HTMLFormElement>, id: string) => {
    event.preventDefault()
    const name = renameValue.trim()
    if (busy || !name) return
    setBusy(true)
    setRowError(null)
    try {
      putBookmarkFolder(await renameBookmarkFolder(id, name))
      setRowMode(null)
    } catch (error) {
      setRowError(errorMessage(error, "Couldn't rename the folder."))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string) => {
    if (busy) return
    setBusy(true)
    setRowError(null)
    const deleted = await deleteBookmarkFolder(id).catch(() => false)
    setBusy(false)
    if (!deleted) {
      setRowError("Couldn't delete the folder. Please try again.")
      return
    }
    removeBookmarkFolder(id)
    setRowMode(null)
    onDeleted(id, folders.filter((folder) => folder.id !== id).length)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bookmark folders</DialogTitle>
          <DialogDescription>
            Only you can see your folders. A bookmark can be in one folder.
          </DialogDescription>
        </DialogHeader>
        <AddBar
          label="New folder"
          buttonLabel="Create"
          buttonDisabled={busy || !newName.trim()}
          error={addError}
          onSubmit={(event) => void onAdd(event)}
          inputRef={addInputRef}
          inputProps={{
            value: newName,
            onChange: (event) => setNewName(event.target.value),
            placeholder: 'New folder name',
            maxLength: MAX_BOOKMARK_FOLDER_NAME_LENGTH,
            autoComplete: 'off',
            autoFocus: true
          }}
        />
        {/* A failed rename or delete; the row stays open to retry. */}
        {rowMode && rowError ? <Alert title={rowError} /> : null}
        {folders.length > 0 ? (
          <FramedList
            aria-label="Your bookmark folders"
            className="max-h-[50vh] overflow-y-auto"
          >
            {folders.map((folder) => {
              const mode = rowMode?.id === folder.id ? rowMode.mode : null
              return (
                <FramedListItem key={folder.id}>
                  {mode === 'rename' ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(event) => void onRename(event, folder.id)}
                    >
                      <Input
                        aria-label={`New name for ${folder.name}`}
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        maxLength={MAX_BOOKMARK_FOLDER_NAME_LENGTH}
                        autoComplete="off"
                        autoFocus
                      />
                      <Button
                        type="submit"
                        size="sm"
                        className="pointer-coarse:h-10"
                        disabled={busy || !renameValue.trim()}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="pointer-coarse:h-10"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setRowMode(null)}
                      >
                        Cancel
                      </Button>
                    </form>
                  ) : mode === 'delete' ? (
                    <div className="space-y-2">
                      <p className="text-sm">
                        Delete “{folder.name}”? Bookmarks in this folder stay in
                        All bookmarks.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="pointer-coarse:h-10"
                          variant="destructive"
                          disabled={busy}
                          onClick={() => void onDelete(folder.id)}
                        >
                          Delete folder
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="pointer-coarse:h-10"
                          variant="outline"
                          disabled={busy}
                          onClick={() => setRowMode(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <Folder className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {folder.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Rename ${folder.name}`}
                        className="pointer-coarse:size-10"
                        disabled={busy}
                        onClick={() => startRow(folder, 'rename')}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${folder.name}`}
                        disabled={busy}
                        onClick={() => startRow(folder, 'delete')}
                        className="text-destructive-text hover:text-destructive-text pointer-coarse:size-10"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </FramedListItem>
              )
            })}
          </FramedList>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
