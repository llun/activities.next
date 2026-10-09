'use client'

import {
  Check,
  Folder,
  Globe,
  Link2,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Star,
  Trash2,
  X
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useCallback, useEffect, useId, useRef, useState } from 'react'

import { GalleryAlbumFormDialog } from '@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog'
import { GalleryAlbumHero } from '@/app/(timeline)/gallery/albums/GalleryAlbumHero'
import { GalleryAlbumSpeciesFilter } from '@/app/(timeline)/gallery/albums/GalleryAlbumSpeciesFilter'
import { GalleryAlbumThumb } from '@/app/(timeline)/gallery/albums/GalleryAlbumThumb'
import {
  ALBUM_SORT_LABELS,
  TOUCH_BUTTON_CLASS,
  formatAlbumDateRange,
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
import { useCopyToClipboard } from '@/lib/hooks/useCopyToClipboard'
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
  /** The album's public address (`<origin>/@user@domain/albums/<id>`). */
  shareUrl: string
  detail: GalleryAlbumDetailResponse
  pageSize: number
}

// Small toolbar buttons grow to a 40px target on a touch screen.
const TOUCH_SM_BUTTON = 'pointer-coarse:h-10'

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

export const GalleryAlbumDetailView: FC<Props> = ({
  ownerId,
  shareUrl,
  detail,
  pageSize
}) => {
  const router = useRouter()
  const { album, facts, hiddenPlaceCount, species } = detail
  const { copied, copy } = useCopyToClipboard()
  const shareHintId = useId()

  const [items, setItems] = useState<GalleryItemEntity[]>(detail.page.items)
  const [nextMaxId, setNextMaxId] = useState<string | null>(
    detail.page.nextMaxId
  )
  const [sort, setSort] = useState<GalleryAlbumSort>(album.sortOrder)
  const [subject, setSubject] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [dialog, setDialog] = useState<'edit' | 'add' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Read out by screen readers after a change the grid cannot say itself.
  const [announcement, setAnnouncement] = useState('')
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const generation = useRef(0)
  // The sort and species the grid and its cursor were last loaded with. A
  // change the reload cannot load is put back to these, so "Load more" never
  // pairs a cursor of one order with another.
  const committed = useRef<{ sort: GalleryAlbumSort; subject: string | null }>({
    sort: album.sortOrder,
    subject: null
  })
  const gridRef = useRef<HTMLDivElement>(null)
  // Where focus goes once a removed photo has left the grid.
  const pendingFocus = useRef<number | null>(null)
  // The photo made the cover, whose tile takes focus once the buttons are
  // enabled again.
  const pendingCoverFocus = useRef<string | null>(null)

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
  // chip, or the album after an edit). A slow older answer is dropped. When
  // the query fails the sort and species go back to the last ones that loaded
  // (the grid and its cursor still belong to those), and the result is false.
  const reload = useCallback(
    async (
      nextSort: GalleryAlbumSort,
      nextSubject: string | null,
      { revert = true }: { revert?: boolean } = {}
    ): Promise<boolean> => {
      const current = ++generation.current
      setIsLoading(true)
      setLoadError(null)
      try {
        const page = await fetchPage(nextSort, nextSubject)
        if (current !== generation.current) return true
        setItems(page.items)
        setNextMaxId(page.nextMaxId)
        committed.current = { sort: nextSort, subject: nextSubject }
        return true
      } catch (error) {
        if (current !== generation.current) return true
        if (revert) {
          setSort(committed.current.sort)
          setSubject(committed.current.subject)
        }
        setLoadError(getErrorMessage(error, 'Failed to load photos.'))
        return false
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
    // The filter is gone for good, so a failed reload cannot put it back (the
    // effect would only ask again). Drop the cursor of the old query instead.
    void reload(sort, null, { revert: false }).then((loaded) => {
      if (!loaded) setNextMaxId(null)
    })
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

  // After Set as cover the pressed button is replaced by the cover marker, so
  // focus the new cover's Remove button (the tile's one control left) once the
  // buttons are enabled again.
  useEffect(() => {
    const mediaId = pendingCoverFocus.current
    if (mediaId === null || busyId !== null) return
    pendingCoverFocus.current = null
    const buttons = gridRef.current?.querySelectorAll<HTMLElement>(
      '[data-remove-photo]'
    )
    const target = Array.from(buttons ?? []).find(
      (button) => button.dataset.remove === mediaId
    )
    ;(target ?? gridRef.current)?.focus()
  }, [busyId])

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
      pendingCoverFocus.current = item.mediaId
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
  // Why the link may not do what a visitor expects. A private album has no
  // page at all (the button is inert); a public one with no public photo is a
  // not-found page for everyone signed out or not following the owner (the
  // facts are computed for the logged-out audience, so a follower may still
  // see followers-only photos) until one is.
  const shareHint = !isPublic
    ? 'Make this album public to share its link.'
    : facts.photoCount === 0
      ? 'No photo here is public yet, so anyone signed out (and anyone who does not follow you) sees a not-found page.'
      : null
  // The hero shows the explicit cover, else the newest photo: mark whichever
  // it is.
  const effectiveCoverId = album.coverMediaId ?? album.cover?.mediaId ?? null

  return (
    <div className="space-y-5">
      <BackLink href="/gallery/albums" accessibleName="Back to albums" />

      <GalleryAlbumHero
        title={album.title}
        cover={album.cover}
        dateRange={dateRange}
        countryName={facts.countryName}
      />

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
        {/* Not `disabled`: a disabled button leaves the tab order, so its
            hint could never be reached by keyboard. `aria-disabled` keeps it
            focusable and the visible hint below is its description. */}
        <Button
          variant="outline"
          size="sm"
          className={cn(
            TOUCH_SM_BUTTON,
            !isPublic && 'cursor-not-allowed opacity-50'
          )}
          aria-disabled={!isPublic}
          aria-describedby={shareHint ? shareHintId : undefined}
          onClick={() => {
            if (isPublic) void copy(shareUrl)
          }}
        >
          {copied ? <Check /> : <Link2 />}
          {copied ? 'Link copied' : 'Share link'}
        </Button>
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
          {copied ? 'Link copied.' : announcement}
        </span>
      </div>
      {shareHint ? (
        <p id={shareHintId} className="text-muted-foreground -mt-2 text-xs">
          {shareHint}
        </p>
      ) : null}

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
              <GalleryAlbumSpeciesFilter
                species={species}
                total={album.itemCount}
                subject={subject}
                onChange={handleSubjectChange}
              />
            ) : (
              <span />
            )}
            <Select
              aria-label="Sort photos"
              className="w-auto max-w-full pointer-coarse:h-10"
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
                  const isCover = effectiveCoverId === item.mediaId
                  const isPinned = album.coverMediaId === item.mediaId
                  const label = getAlbumTileLabel(item, index)
                  return (
                    <li key={item.mediaId} className="min-w-0">
                      <div className="bg-muted/20 relative aspect-square overflow-hidden rounded-md">
                        <GalleryAlbumThumb item={item} />
                        <button
                          type="button"
                          aria-label={`Remove ${label} from album`}
                          data-remove-photo=""
                          data-remove={item.mediaId}
                          disabled={busyId !== null}
                          onClick={() => void handleRemove(item, index)}
                          className={cn(
                            'focus-visible:outline-primary absolute top-1.5 right-1.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/80 focus-visible:outline-2 disabled:opacity-50',
                            TOUCH_BUTTON_CLASS
                          )}
                        >
                          <X className="size-4" aria-hidden="true" />
                        </button>
                        {isCover && isPinned ? (
                          <span
                            data-testid="album-cover-marker"
                            className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-xs font-medium text-white"
                          >
                            <Star
                              className="size-3 fill-current"
                              aria-hidden="true"
                            />
                            Cover
                          </span>
                        ) : (
                          <button
                            type="button"
                            data-testid={
                              isCover
                                ? 'album-cover-marker-pin'
                                : 'album-set-cover'
                            }
                            aria-label={
                              isCover
                                ? `Keep ${label} as cover`
                                : `Set ${label} as cover`
                            }
                            disabled={busyId !== null}
                            onClick={() => void handleSetCover(item, index)}
                            className={cn(
                              'focus-visible:outline-primary absolute bottom-1.5 left-1.5 inline-flex h-7 cursor-pointer items-center gap-1 rounded-full bg-black/65 px-1.5 text-xs font-medium whitespace-nowrap text-white hover:bg-black/80 focus-visible:outline-2 disabled:opacity-50 max-[380px]:w-7 max-[380px]:justify-center max-[380px]:px-0',
                              TOUCH_BUTTON_CLASS
                            )}
                          >
                            <Star
                              className={cn(
                                'size-3',
                                isCover && 'fill-current'
                              )}
                              aria-hidden="true"
                            />
                            <span className="max-[380px]:hidden">
                              {isCover ? 'Cover' : 'Set as cover'}
                            </span>
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <GalleryGrid
                items={items}
                albumsOwnerId={ownerId}
                // The lightbox pill can take a photo out of this very album;
                // the grid, facts and count behind it are read again when the
                // viewer closes (not under it, which would swap the photo
                // being looked at and lose its Undo).
                onAlbumsChanged={(albumIds) => {
                  if (albumIds.includes(album.id)) void refreshAll()
                }}
              />
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
          storedItemCount={detail.storedItemCount}
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
