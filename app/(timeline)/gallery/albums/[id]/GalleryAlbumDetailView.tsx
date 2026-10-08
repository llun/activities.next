'use client'

import {
  Check,
  Folder,
  Globe,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useCallback, useEffect, useRef, useState } from 'react'

import { GalleryAlbumFormDialog } from '@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog'
import { GalleryAlbumThumb } from '@/app/(timeline)/gallery/albums/GalleryAlbumThumb'
import {
  ALBUM_SORT_LABELS,
  TOUCH_BUTTON_CLASS,
  formatAlbumDateRange,
  getAlbumChipClassName,
  getAlbumFactsParts,
  getAlbumTileLabel,
  getHiddenPlacesLabel
} from '@/app/(timeline)/gallery/albums/galleryAlbumsUi'
import {
  deleteGalleryAlbum,
  getGalleryAlbumItems,
  removeGalleryAlbumItems,
  updateGalleryAlbum
} from '@/lib/client'
import { BackLink } from '@/lib/components/back-link'
import { FitnessAlert } from '@/lib/components/fitness/FitnessAlert'
import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import { GalleryGrid } from '@/lib/components/gallery/GalleryGrid'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { Badge } from '@/lib/components/ui/badge'
import { Button } from '@/lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/lib/components/ui/dialog'
import { Select } from '@/lib/components/ui/select'
import type {
  GalleryAlbumDetailResponse,
  GalleryAlbumMediaPage
} from '@/lib/services/gallery/galleryAlbumEntities'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import {
  GALLERY_ALBUM_SORTS,
  type GalleryAlbumSort
} from '@/lib/types/database/galleryAlbums'
import { cn } from '@/lib/utils'

interface Props {
  ownerId: string
  detail: GalleryAlbumDetailResponse
  pageSize: number
}

// Small toolbar buttons grow to a 40px target on a touch screen.
const TOUCH_SM_BUTTON = 'pointer-coarse:h-10'

// The chips beyond these sit behind a "+N" so the grid stays near the top.
const MAX_VISIBLE_CHIPS = 5

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

export const GalleryAlbumDetailView: FC<Props> = ({
  ownerId,
  detail,
  pageSize
}) => {
  const router = useRouter()
  const { album, facts, hiddenPlaceCount, species } = detail

  const [items, setItems] = useState<GalleryItemEntity[]>(detail.page.items)
  const [nextMaxId, setNextMaxId] = useState<string | null>(
    detail.page.nextMaxId
  )
  const [sort, setSort] = useState<GalleryAlbumSort>(album.sortOrder)
  const [subject, setSubject] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [showAllSpecies, setShowAllSpecies] = useState(false)
  const [dialog, setDialog] = useState<'edit' | 'add' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Read out by screen readers after a change the grid cannot say itself.
  const [announcement, setAnnouncement] = useState('')
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const generation = useRef(0)
  const gridRef = useRef<HTMLDivElement>(null)
  // Where focus goes once a removed photo has left the grid.
  const pendingFocus = useRef<number | null>(null)

  const fetchPage = useCallback(
    async (
      nextSort: GalleryAlbumSort,
      nextSubject: string | null,
      cursor?: string
    ): Promise<GalleryAlbumMediaPage> =>
      getGalleryAlbumItems(album.id, {
        limit: pageSize,
        sort: nextSort,
        subject: nextSubject ?? undefined,
        maxId: cursor
      }),
    [album.id, pageSize]
  )

  // Replaces the grid with the first page of a query (a new sort, a species
  // chip, or the album after an edit). A slow older answer is dropped.
  const reload = useCallback(
    async (nextSort: GalleryAlbumSort, nextSubject: string | null) => {
      const current = ++generation.current
      setIsLoading(true)
      setLoadError(null)
      try {
        const page = await fetchPage(nextSort, nextSubject)
        if (current !== generation.current) return
        setItems(page.items)
        setNextMaxId(page.nextMaxId)
      } catch (error) {
        if (current !== generation.current) return
        setLoadError(getErrorMessage(error, 'Failed to load photos.'))
      } finally {
        if (current === generation.current) setIsLoading(false)
      }
    },
    [fetchPage]
  )

  const loadMore = async () => {
    if (!nextMaxId) return
    const current = generation.current
    setIsLoading(true)
    setLoadError(null)
    try {
      const page = await fetchPage(sort, subject, nextMaxId)
      if (current !== generation.current) return
      setItems((existing) => {
        const seen = new Set(existing.map((item) => item.mediaId))
        return [
          ...existing,
          ...page.items.filter((item) => !seen.has(item.mediaId))
        ]
      })
      setNextMaxId(page.nextMaxId)
    } catch (error) {
      if (current !== generation.current) return
      setLoadError(getErrorMessage(error, 'Failed to load photos.'))
    } finally {
      if (current === generation.current) setIsLoading(false)
    }
  }

  const handleSortChange = (next: GalleryAlbumSort) => {
    setSort(next)
    void reload(next, subject)
  }

  const handleSubjectChange = (next: string | null) => {
    setSubject(next)
    void reload(sort, next)
  }

  // A species filter outlives its last photo when that photo is removed: the
  // refreshed chips no longer list it, and with no other species the chip row
  // is gone too, so nothing could clear it. Drop the filter then.
  useEffect(() => {
    if (subject === null || species.some((chip) => chip.key === subject)) {
      return
    }
    setSubject(null)
    void reload(sort, null)
  }, [species, subject, sort, reload])

  // After a removal, focus the photo that took its place (or the one before
  // it, or the grid), so keyboard users are not dropped on the page body.
  useEffect(() => {
    const index = pendingFocus.current
    if (index === null) return
    pendingFocus.current = null
    const buttons = gridRef.current?.querySelectorAll<HTMLElement>(
      '[data-remove-photo]'
    )
    const target = buttons?.length
      ? buttons[Math.min(index, buttons.length - 1)]
      : gridRef.current
    target?.focus()
  }, [items])

  // After anything that changes the album: the facts, chips and cover come
  // from the server render, the grid from here.
  const refreshAll = async () => {
    router.refresh()
    await reload(sort, subject)
  }

  const handleRemove = async (item: GalleryItemEntity, index: number) => {
    setBusyId(item.mediaId)
    setActionError(null)
    try {
      await removeGalleryAlbumItems(album.id, [item.mediaId])
      pendingFocus.current = index
      setItems((existing) =>
        existing.filter(({ mediaId }) => mediaId !== item.mediaId)
      )
      setAnnouncement(
        `Removed ${getAlbumTileLabel(item, index)} from the album.`
      )
      router.refresh()
    } catch (error) {
      setActionError(getErrorMessage(error, 'Failed to remove the photo.'))
    } finally {
      setBusyId(null)
    }
  }

  const handleSetCover = async (item: GalleryItemEntity, index: number) => {
    setBusyId(item.mediaId)
    setActionError(null)
    try {
      await updateGalleryAlbum(album.id, { coverMediaId: item.mediaId })
      setAnnouncement(`${getAlbumTileLabel(item, index)} is now the cover.`)
      router.refresh()
    } catch (error) {
      setActionError(getErrorMessage(error, 'Failed to set the cover.'))
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteGalleryAlbum(album.id)
      router.push('/gallery/albums')
      router.refresh()
    } catch (error) {
      setDeleteError(getErrorMessage(error, 'Failed to delete the album.'))
      setIsDeleting(false)
    }
  }

  const handleDeleteOpenChange = (open: boolean) => {
    if (isDeleting) return
    setIsDeleteOpen(open)
    if (!open) setDeleteError(null)
  }

  const isPublic = album.visibility === 'public'
  const dateRange = formatAlbumDateRange(album.firstAt, album.lastAt)
  const isEmpty = album.itemCount === 0
  const factsParts = getAlbumFactsParts(facts)

  return (
    <div className="space-y-5">
      <BackLink href="/gallery/albums" accessibleName="Back to albums" />

      {album.cover ? (
        <div className="bg-muted/40 relative aspect-[4/3] w-full overflow-hidden rounded-xl border sm:aspect-[16/7]">
          <GalleryAlbumThumb
            item={album.cover}
            loading="eager"
            quality="full"
          />
          <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 via-black/30 to-transparent p-4 text-white sm:p-6">
            <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
              {album.title}
            </h1>
            {dateRange ? (
              <p className="mt-1 text-sm text-white/85">
                {dateRange}
                {facts.countryName ? ` · ${facts.countryName}` : ''}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <div>
          <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
            {album.title}
          </h1>
          {dateRange ? (
            <p className="text-muted-foreground mt-1 text-sm">
              {dateRange}
              {facts.countryName ? ` · ${facts.countryName}` : ''}
            </p>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="default"
          size="sm"
          className={TOUCH_SM_BUTTON}
          onClick={() => setDialog('add')}
        >
          <Plus />
          Add photos
        </Button>
        <Button
          variant={isEditing ? 'secondary' : 'outline'}
          size="sm"
          className={TOUCH_SM_BUTTON}
          onClick={() => setIsEditing((current) => !current)}
        >
          {isEditing ? <Check /> : <Pencil />}
          {isEditing ? 'Done' : 'Edit'}
        </Button>
        {isEditing ? (
          <Button
            variant="outline"
            size="sm"
            className={TOUCH_SM_BUTTON}
            onClick={() => setDialog('edit')}
          >
            <Pencil />
            Edit details
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className={cn(
            TOUCH_SM_BUTTON,
            'text-destructive hover:bg-destructive/10 hover:text-destructive-text'
          )}
          onClick={() => setIsDeleteOpen(true)}
        >
          <Trash2 />
          Delete
        </Button>
        <span role="status" className="sr-only">
          {announcement}
        </span>
      </div>

      {actionError ? <FitnessAlert title={actionError} /> : null}

      {album.description ? (
        <p className="text-sm break-words whitespace-pre-line">
          {album.description}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span>{factsParts.join(' · ')}</span>
          {hiddenPlaceCount > 0 ? (
            <Badge tone="success">
              <ShieldCheck className="size-3" aria-hidden="true" />
              {getHiddenPlacesLabel(hiddenPlaceCount)}
            </Badge>
          ) : null}
          <Badge tone={isPublic ? 'primary' : 'gray'}>
            {isPublic ? (
              <Globe className="size-3" aria-hidden="true" />
            ) : (
              <Lock className="size-3" aria-hidden="true" />
            )}
            {isPublic ? 'Public' : 'Private'}
          </Badge>
        </p>
        {hiddenPlaceCount > 0 ? (
          <p className="text-muted-foreground text-xs">
            Only you see{' '}
            {hiddenPlaceCount === 1 ? 'this place' : 'these places'}. Visitors
            do not, because the photos show a threatened species or its check
            has not finished.
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Counts include only photos from public posts. You see every photo
          below.
        </p>
      </div>

      {isEmpty ? (
        <FitnessEmptyState
          icon={Folder}
          titleAs="h2"
          title="This album is empty"
          action={
            <Button size="sm" onClick={() => setDialog('add')}>
              <Plus />
              Add photos
            </Button>
          }
        >
          Add photos from your gallery to fill it.
        </FitnessEmptyState>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {species.length > 0 ? (
              <div
                role="group"
                aria-label="Filter by species"
                className="flex min-w-0 flex-wrap gap-2"
              >
                <button
                  type="button"
                  aria-pressed={subject === null}
                  onClick={() => handleSubjectChange(null)}
                  className={getAlbumChipClassName(subject === null)}
                >
                  All
                  <span className="tabular-nums">{album.itemCount}</span>
                </button>
                {(showAllSpecies
                  ? species
                  : species.slice(0, MAX_VISIBLE_CHIPS)
                ).map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    aria-pressed={subject === chip.key}
                    onClick={() => handleSubjectChange(chip.key)}
                    className={getAlbumChipClassName(subject === chip.key)}
                  >
                    <span className="max-w-40 truncate">{chip.name}</span>
                    <span className="tabular-nums">{chip.count}</span>
                  </button>
                ))}
                {species.length > MAX_VISIBLE_CHIPS ? (
                  <button
                    type="button"
                    aria-expanded={showAllSpecies}
                    onClick={() => setShowAllSpecies((current) => !current)}
                    className={getAlbumChipClassName(false)}
                  >
                    {showAllSpecies
                      ? 'Fewer'
                      : `+${species.length - MAX_VISIBLE_CHIPS}`}
                  </button>
                ) : null}
              </div>
            ) : (
              <span />
            )}
            <Select
              aria-label="Sort photos"
              className="w-auto max-w-full"
              value={sort}
              onChange={(event) =>
                handleSortChange(event.target.value as GalleryAlbumSort)
              }
            >
              {GALLERY_ALBUM_SORTS.map((value) => (
                <option key={value} value={value}>
                  {ALBUM_SORT_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>

          <div
            ref={gridRef}
            tabIndex={-1}
            aria-busy={isLoading}
            className={cn('outline-none', isLoading && 'opacity-70')}
          >
            {items.length === 0 && !isLoading && !loadError ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                No photos in this view.
              </p>
            ) : isEditing ? (
              <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2">
                {items.map((item, index) => {
                  const isCover = album.coverMediaId === item.mediaId
                  const label = getAlbumTileLabel(item, index)
                  return (
                    <li key={item.mediaId} className="min-w-0">
                      <div className="bg-muted/20 relative aspect-square overflow-hidden rounded-md">
                        <GalleryAlbumThumb item={item} />
                        <button
                          type="button"
                          aria-label={`Remove ${label} from album`}
                          data-remove-photo=""
                          disabled={busyId !== null}
                          onClick={() => void handleRemove(item, index)}
                          className={cn(
                            'focus-visible:outline-primary absolute top-1.5 right-1.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/80 focus-visible:outline-2 disabled:opacity-50',
                            TOUCH_BUTTON_CLASS
                          )}
                        >
                          <X className="size-4" aria-hidden="true" />
                        </button>
                        {isCover ? (
                          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-xs font-medium text-white">
                            <Star className="size-3" aria-hidden="true" />
                            Cover
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Set ${label} as cover`}
                            disabled={busyId !== null}
                            onClick={() => void handleSetCover(item, index)}
                            className={cn(
                              'focus-visible:outline-primary absolute bottom-1.5 left-1.5 inline-flex h-7 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full bg-black/65 px-1.5 text-xs font-medium text-white hover:bg-black/80 focus-visible:outline-2 disabled:opacity-50',
                              TOUCH_BUTTON_CLASS
                            )}
                          >
                            <Star className="size-3" aria-hidden="true" />
                            <span className="max-[380px]:hidden">Set as </span>
                            <span className="max-[380px]:capitalize">
                              cover
                            </span>
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <GalleryGrid items={items} />
            )}
          </div>

          {loadError ? (
            <p role="alert" className="text-destructive text-sm">
              {loadError}
            </p>
          ) : null}
          {nextMaxId ? (
            <LoadMoreButton
              isLoading={isLoading}
              loadingText="Loading more"
              onClick={() => void loadMore()}
            />
          ) : loadError && items.length === 0 ? (
            <LoadMoreButton onClick={() => void reload(sort, subject)}>
              Try again
            </LoadMoreButton>
          ) : null}
        </div>
      )}

      {dialog && (
        <GalleryAlbumFormDialog
          open
          intent={dialog}
          ownerId={ownerId}
          album={album}
          existingMediaIds={detail.mediaIds}
          onOpenChange={(open) => {
            if (!open) setDialog(null)
          }}
          onSaved={() => void refreshAll()}
        />
      )}

      <Dialog open={isDeleteOpen} onOpenChange={handleDeleteOpenChange}>
        <DialogContent showCloseButton={!isDeleting}>
          <DialogHeader>
            <DialogTitle>Delete {album.title}?</DialogTitle>
            <DialogDescription>
              The album goes away. Your photos and posts stay where they are.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-destructive text-sm" role="alert">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleDeleteOpenChange(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Delete album'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
