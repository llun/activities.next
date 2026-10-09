'use client'

import { CheckSquare, Images, X } from 'lucide-react'
import Link from 'next/link'
import { FC, useCallback, useMemo, useState } from 'react'

import { GalleryAlbumFormDialog } from '@/app/(timeline)/gallery/albums/GalleryAlbumFormDialog'
import { GalleryPagedGrid } from '@/lib/components/gallery/GalleryPagedGrid'
import {
  GALLERY_CATEGORY_ICONS,
  GALLERY_CATEGORY_LABELS
} from '@/lib/components/gallery/galleryCategories'
import { PageHeader } from '@/lib/components/page-header'
import {
  SectionNavSelect,
  type SectionNavSelectTab
} from '@/lib/components/section-nav-select'
import { Button } from '@/lib/components/ui/button'
import type {
  GalleryItemEntity,
  GalleryMediaPage
} from '@/lib/services/gallery/galleryEntities'
import {
  MEDIA_SUBJECT_CATEGORIES,
  type MediaSubjectCategory
} from '@/lib/types/database/gallery'

import { GalleryAddToAlbumDialog } from './GalleryAddToAlbumDialog'
import { GallerySelectionBar } from './GallerySelectionBar'

interface Props {
  actorId: string
  initialCategory: MediaSubjectCategory | null
  initialPage: GalleryMediaPage
}

type Filter = MediaSubjectCategory | 'all'

const FILTER_TABS: SectionNavSelectTab<Filter>[] = [
  { id: 'all', label: 'All photos and videos', icon: Images },
  ...MEDIA_SUBJECT_CATEGORIES.map((category) => ({
    id: category,
    label: GALLERY_CATEGORY_LABELS[category],
    icon: GALLERY_CATEGORY_ICONS[category]
  }))
]

interface Outcome {
  message: string
  albumId: string
}

export const GalleryRecentView: FC<Props> = ({
  actorId,
  initialCategory,
  initialPage
}) => {
  const [filter, setFilterState] = useState<Filter>(initialCategory ?? 'all')
  const startFilter = initialCategory ?? 'all'
  const [isSelecting, setIsSelecting] = useState(false)
  // In the order they were picked: the first is the cover of a new album.
  const [selected, setSelected] = useState<string[]>([])
  const [loaded, setLoaded] = useState<GalleryItemEntity[]>([])
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const selectedItems = useMemo(
    () => loaded.filter((item) => selectedSet.has(item.mediaId)),
    [loaded, selectedSet]
  )

  const setFilter = (next: Filter) => {
    // A different filter is a different list: a selection does not carry over.
    setSelected([])
    setFilterState(next)
  }

  const toggle = useCallback((item: GalleryItemEntity) => {
    setSelected((current) =>
      current.includes(item.mediaId)
        ? current.filter((id) => id !== item.mediaId)
        : [...current, item.mediaId]
    )
  }, [])
  const selection = useMemo(
    () =>
      isSelecting ? { selected: selectedSet, onToggle: toggle } : undefined,
    [isSelecting, selectedSet, toggle]
  )

  const stopSelecting = () => {
    setIsSelecting(false)
    setSelected([])
  }

  const selectAllLoaded = () =>
    setSelected((current) => [
      ...current,
      ...loaded
        .map((item) => item.mediaId)
        .filter((id) => !current.includes(id))
    ])

  const finish = (result: Outcome) => {
    setOutcome(result)
    stopSelecting()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recent"
        description="Your newest photos and videos first"
        actions={
          <Button
            type="button"
            variant="outline"
            aria-pressed={isSelecting}
            className="pointer-coarse:h-10"
            onClick={() => {
              setOutcome(null)
              if (isSelecting) stopSelecting()
              else setIsSelecting(true)
            }}
          >
            {isSelecting ? (
              <X aria-hidden="true" />
            ) : (
              <CheckSquare aria-hidden="true" />
            )}
            {isSelecting ? 'Cancel' : 'Select'}
          </Button>
        }
      />
      <SectionNavSelect
        label="Category"
        tabs={FILTER_TABS}
        active={filter}
        onChange={setFilter}
      />
      {outcome ? (
        <div
          role="status"
          className="bg-card flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm"
        >
          <p className="min-w-0 flex-1 break-words">
            {outcome.message}{' '}
            <Link
              href={`/gallery/albums/${encodeURIComponent(outcome.albumId)}`}
              prefetch={false}
              className="text-primary-text font-medium hover:underline"
            >
              Open album
            </Link>
          </p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setOutcome(null)}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-6 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-[3px] pointer-coarse:size-10"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      <GalleryPagedGrid
        // A different filter is a different query, so a fresh grid.
        key={filter}
        actorId={actorId}
        category={filter === 'all' ? undefined : filter}
        initialPage={filter === startFilter ? initialPage : undefined}
        emptyTitle={
          filter === 'all'
            ? 'No photos in your gallery yet'
            : `No ${GALLERY_CATEGORY_LABELS[filter].toLowerCase()} yet`
        }
        selection={selection}
        albumsOwnerId={actorId}
        onItemsChange={setLoaded}
      />
      {isSelecting ? (
        <GallerySelectionBar
          count={selected.length}
          loadedCount={loaded.length}
          onSelectAllLoaded={selectAllLoaded}
          onClear={() => setSelected([])}
          onAddToAlbum={() => setIsAddOpen(true)}
        />
      ) : null}

      <GalleryAddToAlbumDialog
        open={isAddOpen}
        mediaIds={selected}
        onOpenChange={setIsAddOpen}
        onNewAlbum={() => {
          setIsAddOpen(false)
          setIsCreateOpen(true)
        }}
        onAdded={finish}
      />
      <GalleryAlbumFormDialog
        open={isCreateOpen}
        ownerId={actorId}
        intent="create"
        initialMediaIds={selected}
        initialItems={selectedItems}
        onOpenChange={setIsCreateOpen}
        onSaved={(albumId) =>
          finish({
            albumId,
            message: 'Album created.'
          })
        }
      />
    </div>
  )
}
