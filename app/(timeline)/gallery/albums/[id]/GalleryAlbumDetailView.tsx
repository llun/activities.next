'use client'

import {
  Check,
  Folder,
  Globe,
  Link as LinkIcon,
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
  formatAlbumDateRange,
  getAlbumFactsParts,
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
  /** The album's public address, copied by Share link. */
  shareUrl: string
  detail: GalleryAlbumDetailResponse
  pageSize: number
}

const chipClassName = (isActive: boolean) =>
  cn(
    'focus-visible:ring-ring/50 inline-flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-medium outline-none focus-visible:ring-[3px]',
    isActive
      ? 'border-primary bg-primary/10 text-primary-text'
      : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
  )

// The chips beyond these sit behind a "+N" so the grid stays near the top.
const MAX_VISIBLE_CHIPS = 5

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

const getTileLabel = (item: GalleryItemEntity, index: number) =>
  item.attachment.name?.trim() || item.subject?.name || `photo ${index + 1}`

export const GalleryAlbumDetailView: FC<Props> = ({
  ownerId,
  shareUrl,
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
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>(
    'idle'
  )
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const generation = useRef(0)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    []
  )

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

  // After anything that changes the album: the facts, chips and cover come
  // from the server render, the grid from here.
  const refreshAll = async () => {
    router.refresh()
    await reload(sort, subject)
  }

  const handleRemove = async (item: GalleryItemEntity) => {
    setBusyId(item.mediaId)
    setActionError(null)
    try {
      await removeGalleryAlbumItems(album.id, [item.mediaId])
      setItems((existing) =>
        existing.filter(({ mediaId }) => mediaId !== item.mediaId)
      )
      router.refresh()
    } catch (error) {
      setActionError(getErrorMessage(error, 'Failed to remove the photo.'))
    } finally {
      setBusyId(null)
    }
  }

  const handleSetCover = async (item: GalleryItemEntity) => {
    setBusyId(item.mediaId)
    setActionError(null)
    try {
      await updateGalleryAlbum(album.id, { coverMediaId: item.mediaId })
      router.refresh()
    } catch (error) {
      setActionError(getErrorMessage(error, 'Failed to set the cover.'))
    } finally {
      setBusyId(null)
    }
  }

  const handleCopyLink = async () => {
    // navigator.clipboard is undefined in non-secure (HTTP) contexts.
    let next: 'copied' | 'failed' = 'failed'
    if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareUrl)
        next = 'copied'
      } catch {
        next = 'failed'
      }
    }
    setCopyState(next)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopyState('idle'), 3000)
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
          <GalleryAlbumThumb item={album.cover} loading="eager" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-4 text-white sm:p-6">
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
          variant="outline"
          size="sm"
          onClick={() => void handleCopyLink()}
          disabled={!isPublic}
          title={isPublic ? undefined : 'Make the album public to share it'}
        >
          <LinkIcon />
          Share link
        </Button>
        <Button variant="default" size="sm" onClick={() => setDialog('add')}>
          <Plus />
          Add photos
        </Button>
        <Button
          variant={isEditing ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={isEditing}
          onClick={() => setIsEditing((current) => !current)}
        >
          {isEditing ? <Check /> : <Pencil />}
          {isEditing ? 'Done' : 'Edit'}
        </Button>
        {isEditing ? (
          <Button variant="outline" size="sm" onClick={() => setDialog('edit')}>
            <Pencil />
            Edit details
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive-text"
          onClick={() => setIsDeleteOpen(true)}
        >
          <Trash2 />
          Delete
        </Button>
        <span role="status" className="text-muted-foreground text-xs">
          {copyState === 'copied'
            ? 'Link copied'
            : copyState === 'failed'
              ? 'Couldn’t copy the link'
              : ''}
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
        {isPublic ? (
          <p className="text-muted-foreground text-xs">
            These numbers are what a visitor sees. You see every photo below,
            visitors only the ones their access to the post allows.
          </p>
        ) : null}
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
                  className={chipClassName(subject === null)}
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
                    className={chipClassName(subject === chip.key)}
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
                    className={chipClassName(false)}
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

          <div aria-busy={isLoading} className={cn(isLoading && 'opacity-70')}>
            {items.length === 0 && !isLoading && !loadError ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                No photos in this view.
              </p>
            ) : isEditing ? (
              <ul className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2">
                {items.map((item, index) => {
                  const isCover = album.coverMediaId === item.mediaId
                  const label = getTileLabel(item, index)
                  return (
                    <li key={item.mediaId} className="min-w-0">
                      <div className="bg-muted/20 relative aspect-square overflow-hidden rounded-md">
                        <GalleryAlbumThumb item={item} />
                        <button
                          type="button"
                          aria-label={`Remove ${label} from album`}
                          disabled={busyId !== null}
                          onClick={() => void handleRemove(item)}
                          className="focus-visible:outline-primary absolute top-1.5 right-1.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/65 text-white hover:bg-black/80 focus-visible:outline-2 disabled:opacity-50"
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
                            onClick={() => void handleSetCover(item)}
                            className="focus-visible:outline-primary absolute bottom-1.5 left-1.5 inline-flex h-7 cursor-pointer items-center gap-1 rounded-full bg-black/65 px-2 text-xs font-medium text-white hover:bg-black/80 focus-visible:outline-2 disabled:opacity-50"
                          >
                            <Star className="size-3" aria-hidden="true" />
                            Set as cover
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
              The album and its link go away. Your photos and posts stay where
              they are. This action cannot be undone.
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
