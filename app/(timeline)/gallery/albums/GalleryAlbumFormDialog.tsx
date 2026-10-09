'use client'

import { Folder, Globe, Lock } from 'lucide-react'
import { FC, FormEvent, useEffect, useState } from 'react'

import {
  addGalleryAlbumItems,
  createGalleryAlbum,
  updateGalleryAlbum
} from '@/lib/client'
import { GALLERY_ALBUM_ITEMS_BATCH } from '@/lib/client/galleryAlbums'
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
import { Label } from '@/lib/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/lib/components/ui/radio-group'
import { Textarea } from '@/lib/components/ui/textarea'
import type { GalleryAlbumCardEntity } from '@/lib/services/gallery/galleryAlbumEntities'
import {
  DEFAULT_GALLERY_ALBUM_VISIBILITY,
  GALLERY_ALBUM_VISIBILITIES,
  type GalleryAlbumVisibility,
  MAX_GALLERY_ALBUM_DESCRIPTION_LENGTH,
  MAX_GALLERY_ALBUM_ITEMS,
  MAX_GALLERY_ALBUM_TITLE_LENGTH
} from '@/lib/types/database/galleryAlbums'
import { cn } from '@/lib/utils'

import { GalleryAlbumPicker } from './GalleryAlbumPicker'
import { GalleryAlbumThumb } from './GalleryAlbumThumb'

/**
 * `create` is the whole form with the picker; `edit` is the details alone and
 * `add` is the picker alone, for an album that already exists.
 */
export type GalleryAlbumFormIntent = 'create' | 'edit' | 'add'

interface Props {
  open: boolean
  ownerId: string
  intent: GalleryAlbumFormIntent
  /** The album being edited or added to; absent when creating. */
  album?: GalleryAlbumCardEntity | null
  /** Media ids already in the album, shown as such (and not pickable) in the picker. */
  existingMediaIds?: string[]
  /**
   * How many items count against the album's cap, including photos the owner
   * can no longer see. Defaults to the visible count.
   */
  storedItemCount?: number
  onOpenChange: (open: boolean) => void
  /** Called with the album id once everything asked for is saved. */
  onSaved: (albumId: string) => void
}

const VISIBILITY_COPY: Record<
  GalleryAlbumVisibility,
  { label: string; hint: string; icon: typeof Globe }
> = {
  public: {
    label: 'Public',
    hint: 'Anyone with the link can open it, and sees only the photos from posts they may read.',
    icon: Globe
  },
  private: { label: 'Private', hint: 'Only you can see it.', icon: Lock }
}

const TITLES: Record<GalleryAlbumFormIntent, string> = {
  create: 'New album',
  edit: 'Edit album',
  add: 'Add photos'
}

const SUBMIT_LABELS: Record<GalleryAlbumFormIntent, string> = {
  create: 'Create album',
  edit: 'Save changes',
  add: 'Add to album'
}

const formatCount = (count: number) => count.toLocaleString('en-US')

export const GalleryAlbumFormDialog: FC<Props> = ({
  open,
  ownerId,
  intent,
  album = null,
  existingMediaIds,
  storedItemCount,
  onOpenChange,
  onSaved
}) => {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<GalleryAlbumVisibility>(
    DEFAULT_GALLERY_ALBUM_VISIBILITY
  )
  const [selected, setSelected] = useState<string[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set once the album exists but a later step failed, so a retry opens it
  // instead of creating a second one.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [coverItem, setCoverItem] =
    useState<GalleryAlbumCardEntity['cover']>(null)

  // Seed the fields whenever the dialog opens so a cancelled edit never leaks
  // into the next one.
  useEffect(() => {
    if (!open) return
    setTitle(album?.title ?? '')
    setDescription(album?.description ?? '')
    setVisibility(album?.visibility ?? DEFAULT_GALLERY_ALBUM_VISIBILITY)
    setSelected([])
    setError(null)
    setCreatedId(null)
    setCoverItem(null)
  }, [open, album])

  // Once the album exists the form is only a way to open it: edits made after
  // that point would be dropped, so the fields stop taking them.
  const isLocked = isSaving || createdId !== null
  const showFields = intent !== 'add'
  const showPicker = intent !== 'edit'
  const capacity =
    intent === 'add'
      ? Math.max(
          MAX_GALLERY_ALBUM_ITEMS - (storedItemCount ?? album?.itemCount ?? 0),
          0
        )
      : MAX_GALLERY_ALBUM_ITEMS

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (createdId) {
      onSaved(createdId)
      onOpenChange(false)
      return
    }

    const trimmedTitle = title.trim()
    if (showFields && !trimmedTitle) {
      setError('Give the album a title.')
      return
    }
    if (intent === 'add' && selected.length === 0) {
      setError('Choose at least one photo.')
      return
    }

    setError(null)
    setIsSaving(true)
    let albumId = album?.id ?? null
    try {
      if (intent === 'create') {
        const created = await createGalleryAlbum({
          title: trimmedTitle,
          description: description.trim() || null,
          visibility,
          mediaIds: selected.slice(0, GALLERY_ALBUM_ITEMS_BATCH)
        })
        albumId = created.album.id
        setCreatedId(created.album.id)
        const rest = selected.slice(GALLERY_ALBUM_ITEMS_BATCH)
        if (rest.length > 0) await addGalleryAlbumItems(created.album.id, rest)
        // The first photo picked is the cover, as the form says.
        if (selected.length > 0) {
          await updateGalleryAlbum(created.album.id, {
            coverMediaId: selected[0]
          })
        }
      } else if (intent === 'edit' && album) {
        await updateGalleryAlbum(album.id, {
          title: trimmedTitle,
          description: description.trim() || null,
          visibility
        })
      } else if (album) {
        await addGalleryAlbumItems(album.id, selected)
      }
      if (albumId) onSaved(albumId)
      onOpenChange(false)
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : 'Failed to save.'
      setError(
        intent === 'create' && albumId
          ? `The album was created, but not everything was added: ${message}`
          : message
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (isSaving) return
    // The album exists already; closing is as good as opening it.
    if (!next && createdId) onSaved(createdId)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[90dvh] flex-col gap-4 overflow-hidden p-4 sm:p-6',
          showFields && showPicker ? 'sm:max-w-4xl' : 'sm:max-w-xl'
        )}
        showCloseButton={!isSaving}
      >
        <DialogHeader>
          <DialogTitle>{TITLES[intent]}</DialogTitle>
          <DialogDescription className="sr-only">
            {intent === 'create'
              ? 'Name the album and choose its first photos. Nothing is saved until you create it.'
              : intent === 'edit'
                ? 'Change the album’s title, description and who can see it.'
                : 'Choose photos from your gallery to add. Nothing is saved until you add them.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <div
            className={cn(
              'min-h-0 flex-1 gap-5 overflow-y-auto pr-1',
              showFields && showPicker
                ? 'grid md:grid-cols-[16rem_minmax(0,1fr)]'
                : 'block'
            )}
          >
            {showFields ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="gallery-album-title">Title</Label>
                  <Input
                    id="gallery-album-title"
                    value={title}
                    maxLength={MAX_GALLERY_ALBUM_TITLE_LENGTH}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled={isLocked}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gallery-album-description">
                    Description{' '}
                    <span className="text-muted-foreground font-normal">
                      (optional)
                    </span>
                  </Label>
                  <Textarea
                    id="gallery-album-description"
                    value={description}
                    maxLength={MAX_GALLERY_ALBUM_DESCRIPTION_LENGTH}
                    rows={3}
                    onChange={(event) => setDescription(event.target.value)}
                    disabled={isLocked}
                  />
                </div>
                <div className="space-y-1.5">
                  <p
                    id="gallery-album-visibility-label"
                    className="text-sm leading-5 font-medium"
                  >
                    Visibility
                  </p>
                  <RadioGroup
                    aria-labelledby="gallery-album-visibility-label"
                    value={visibility}
                    onValueChange={(value) =>
                      setVisibility(value as GalleryAlbumVisibility)
                    }
                    disabled={isLocked}
                    className="gap-1.5"
                  >
                    {GALLERY_ALBUM_VISIBILITIES.map((value) => {
                      const { label, hint, icon: Icon } = VISIBILITY_COPY[value]
                      const id = `gallery-album-visibility-${value}`
                      return (
                        <div
                          key={value}
                          className={cn(
                            'flex items-start gap-3 rounded-lg border p-3',
                            visibility === value &&
                              'border-primary bg-primary/5'
                          )}
                        >
                          <RadioGroupItem
                            value={value}
                            id={id}
                            className="mt-0.5 shrink-0"
                          />
                          <div className="min-w-0 space-y-0.5">
                            <Label
                              htmlFor={id}
                              className="cursor-pointer gap-1.5 font-medium"
                            >
                              <Icon className="size-3.5" aria-hidden="true" />
                              {label}
                            </Label>
                            <p className="text-muted-foreground text-xs">
                              {hint}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </RadioGroup>
                  <p className="text-muted-foreground text-xs">
                    A photo is only ever as visible as the post it came from.
                  </p>
                </div>
                {intent === 'create' ? (
                  <div className="space-y-1.5">
                    <p className="text-sm leading-5 font-medium">Cover</p>
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="bg-muted/40 text-muted-foreground flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border"
                      >
                        {coverItem ? (
                          <GalleryAlbumThumb item={coverItem} />
                        ) : (
                          <Folder className="size-5" />
                        )}
                      </span>
                      <p className="text-muted-foreground text-xs">
                        First selected photo. Change later from the album.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {showPicker ? (
              <div className="min-w-0 space-y-2">
                {showFields ? (
                  <p className="text-sm leading-5 font-medium">From gallery</p>
                ) : null}
                <GalleryAlbumPicker
                  ownerId={ownerId}
                  selected={selected}
                  onChange={setSelected}
                  onFirstItemChange={setCoverItem}
                  capacity={capacity}
                  existingIds={existingMediaIds}
                  disabled={isLocked}
                />
              </div>
            ) : null}
          </div>

          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}

          <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between">
            {showPicker ? (
              <p
                className="text-muted-foreground text-sm"
                aria-live="polite"
                data-testid="album-selection-count"
              >
                {intent === 'add'
                  ? `${formatCount(selected.length)} selected · can add up to ${formatCount(Math.max(capacity - selected.length, 0))} more`
                  : `${formatCount(selected.length)} selected · max ${formatCount(capacity)} per album`}
              </p>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSaving}
              >
                {createdId ? 'Close' : 'Cancel'}
              </Button>
              <Button type="submit" disabled={isSaving}>
                {createdId
                  ? 'Open album'
                  : isSaving
                    ? 'Saving…'
                    : SUBMIT_LABELS[intent]}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
