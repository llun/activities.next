'use client'

import { Folder, Lock, Plus } from 'lucide-react'
import { FC, useEffect, useState } from 'react'

import {
  GalleryAlbumAddError,
  addGalleryAlbumItems,
  getGalleryAlbums
} from '@/lib/client'
import { getAlbumOptionNames } from '@/lib/components/gallery/mediaAlbumsUi'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Label } from '@/lib/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'
import type {
  GalleryAlbumCardEntity,
  GalleryAlbumItemsResult
} from '@/lib/services/gallery/galleryAlbumEntities'
import { cn } from '@/lib/utils'

import { describeAddFailure, describeAddResult } from './galleryAddToAlbumUi'

interface Props {
  open: boolean
  /** The photos to add, in the order they were selected. */
  mediaIds: string[]
  onOpenChange: (open: boolean) => void
  /** The owner chose "New album": the caller opens the create dialog. */
  onNewAlbum: () => void
  /** Every photo was handled (some may be skipped or already there). */
  onAdded: (summary: { albumId: string; message: string }) => void
}

type AlbumLoad =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; albums: GalleryAlbumCardEntity[] }

const formatCount = (count: number) => count.toLocaleString('en-US')

/**
 * Where a selection from Recent goes: an existing album, or a new one. The add
 * runs in batches of 100 through the client helper, and an album that fills up
 * part way says how far it got.
 */
export const GalleryAddToAlbumDialog: FC<Props> = ({
  open,
  mediaIds,
  onOpenChange,
  onNewAlbum,
  onAdded
}) => {
  const [load, setLoad] = useState<AlbumLoad>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [albumId, setAlbumId] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoad({ status: 'loading' })
    setAlbumId('')
    setError(null)
    getGalleryAlbums()
      .then((response) => {
        if (!cancelled) setLoad({ status: 'ready', albums: response.albums })
      })
      .catch((loadError) => {
        if (cancelled) return
        setLoad({
          status: 'error',
          message:
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load albums.'
        })
      })
    return () => {
      cancelled = true
    }
  }, [open, attempt])

  const albums = load.status === 'ready' ? load.albums : []
  const names = getAlbumOptionNames(albums)
  const chosen = albums.find((album) => album.id === albumId) ?? null
  const count = mediaIds.length

  const handleAdd = async () => {
    if (!chosen || isAdding) return
    setIsAdding(true)
    setError(null)
    try {
      const result: GalleryAlbumItemsResult = await addGalleryAlbumItems(
        chosen.id,
        mediaIds
      )
      onAdded({
        albumId: chosen.id,
        message: describeAddResult(chosen.title, result)
      })
      onOpenChange(false)
    } catch (addError) {
      const failure = addError instanceof GalleryAlbumAddError ? addError : null
      setError(
        describeAddFailure({
          title: chosen.title,
          message:
            addError instanceof Error && addError.message
              ? addError.message
              : 'Try again.',
          isFull: failure?.isFull ?? false,
          earlier: failure?.result ?? null,
          requested: count
        })
      )
    } finally {
      setIsAdding(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (isAdding) return
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[90dvh] flex-col gap-4 overflow-hidden p-4 sm:max-w-md sm:p-6"
        showCloseButton={!isAdding}
      >
        <DialogHeader>
          <DialogTitle className="pr-8">
            Add {formatCount(count)} {count === 1 ? 'photo' : 'photos'} to an
            album
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose an album for the selected photos, or start a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start pointer-coarse:h-10"
            disabled={isAdding}
            onClick={onNewAlbum}
          >
            <Plus aria-hidden="true" />
            New album with {count === 1 ? 'this photo' : 'these photos'}
          </Button>

          {load.status === 'loading' ? (
            <div aria-busy="true" className="space-y-2">
              <span className="sr-only" role="status">
                Loading albums
              </span>
              {Array.from({ length: 3 }, (_, index) => (
                <div
                  key={index}
                  aria-hidden="true"
                  className="skeleton h-11 rounded-lg"
                />
              ))}
            </div>
          ) : load.status === 'error' ? (
            <div className="space-y-2">
              <p role="alert" className="text-destructive text-sm">
                {load.message}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAttempt((current) => current + 1)}
              >
                Try again
              </Button>
            </div>
          ) : albums.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              You have no albums yet. Start one with these photos.
            </p>
          ) : (
            <RadioGroup
              aria-label="Albums"
              value={albumId}
              onValueChange={setAlbumId}
              disabled={isAdding}
              className="gap-1.5"
            >
              {albums.map((album, index) => {
                const id = `add-to-album-${album.id}`
                return (
                  <div
                    key={album.id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-3 pointer-coarse:min-h-12',
                      albumId === album.id && 'border-primary bg-primary/5'
                    )}
                  >
                    <RadioGroupItem
                      value={album.id}
                      id={id}
                      aria-label={names[index]}
                      className="shrink-0"
                    />
                    <Label
                      htmlFor={id}
                      aria-hidden="true"
                      className="min-w-0 flex-1 cursor-pointer gap-2 font-medium"
                    >
                      {album.visibility === 'private' ? (
                        <Lock
                          className="text-muted-foreground size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                      ) : (
                        <Folder
                          className="text-muted-foreground size-3.5 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">{album.title}</span>
                    </Label>
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground shrink-0 text-xs tabular-nums"
                    >
                      {formatCount(album.itemCount)}
                    </span>
                  </div>
                )
              })}
            </RadioGroup>
          )}
        </div>

        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isAdding}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!chosen || isAdding}
          >
            {isAdding
              ? 'Adding…'
              : `Add ${formatCount(count)} ${count === 1 ? 'photo' : 'photos'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
