'use client'

import { FolderOpen, Images, Lock, Plus, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { PageHeader } from '@/lib/components/page-header'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import { StatCell } from '@/lib/components/surface/StatCell'
import { StatStrip } from '@/lib/components/surface/StatStrip'
import { Button } from '@/lib/components/ui/button'
import { formatInteger } from '@/lib/fitness/calendar/format'
import type { GalleryAlbumListResponse } from '@/lib/services/gallery/galleryAlbumEntities'
import { MAX_GALLERY_ALBUMS_PER_ACTOR } from '@/lib/types/database/galleryAlbums'
import { cn } from '@/lib/utils'

import { GalleryAlbumCard } from './GalleryAlbumCard'
import {
  GalleryAlbumFormDialog,
  type GalleryAlbumPickerTab
} from './GalleryAlbumFormDialog'
import { getSuggestedAlbumsLabel } from './galleryAlbumSuggestionsUi'
import { TOUCH_BAND_CLASS, getAlbumChipClassName } from './galleryAlbumsUi'
import { useGalleryAlbumSuggestions } from './useGalleryAlbumSuggestions'

interface Props {
  ownerId: string
  data: GalleryAlbumListResponse
}

type Filter = 'all' | 'public' | 'private'

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  public: 'Public',
  private: 'Private'
}

const FILTERS: Filter[] = ['all', 'public', 'private']

export const GalleryAlbumsView: FC<Props> = ({ ownerId, data }) => {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('all')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createTab, setCreateTab] = useState<GalleryAlbumPickerTab>('gallery')
  const suggestions = useGalleryAlbumSuggestions()
  const suggestionCount =
    suggestions.state.status === 'ready'
      ? suggestions.state.suggestions.length
      : null

  const { albums, photoCount } = data
  const counts: Record<Filter, number> = {
    all: albums.length,
    public: albums.filter((album) => album.visibility === 'public').length,
    private: albums.filter((album) => album.visibility === 'private').length
  }
  const shown =
    filter === 'all'
      ? albums
      : albums.filter((album) => album.visibility === filter)
  const isAtLimit = albums.length >= MAX_GALLERY_ALBUMS_PER_ACTOR

  const openCreate = (tab: GalleryAlbumPickerTab = 'gallery') => {
    setCreateTab(tab)
    setIsCreateOpen(true)
  }
  const hasSuggestions = suggestionCount !== null && suggestionCount > 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Albums"
        description="Group photos that belong together"
        actions={
          <Button
            onClick={() => openCreate()}
            disabled={isAtLimit}
            aria-label="New album"
          >
            <Plus />
            <span className="sm:hidden" aria-hidden="true">
              New
            </span>
            <span className="max-sm:hidden" aria-hidden="true">
              New album
            </span>
          </Button>
        }
      />

      {albums.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          titleAs="h2"
          title="Group photos that belong together"
          action={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => openCreate()}>
                <Plus />
                Create your first album
              </Button>
              {hasSuggestions ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="pointer-coarse:h-10"
                  onClick={() => openCreate('suggestions')}
                >
                  <Sparkles />
                  See suggestions
                </Button>
              ) : suggestions.state.status === 'loading' ? (
                // Holds the place of the button, so the card does not jump.
                <span
                  aria-hidden="true"
                  className="skeleton h-8 w-36 rounded-md pointer-coarse:h-10"
                />
              ) : null}
            </div>
          }
        >
          A trip, a species, a day out. An album never makes a photo more public
          than the post it came from.
        </EmptyState>
      ) : (
        <>
          <StatStrip variant="summary" columns={3}>
            <StatCell
              label="Albums"
              icon={FolderOpen}
              value={formatInteger(albums.length)}
            />
            <StatCell
              label="Photos in albums"
              icon={Images}
              value={formatInteger(photoCount)}
            />
            <StatCell
              label="Suggested"
              icon={Sparkles}
              // A dash while the suggestions are being worked out, and when
              // they could not be.
              value={
                suggestionCount === null ? '–' : formatInteger(suggestionCount)
              }
            />
          </StatStrip>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div
              role="group"
              aria-label="Filter albums"
              className="flex flex-wrap gap-2"
            >
              {FILTERS.map((value) => {
                const isActive = filter === value
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setFilter(value)}
                    className={getAlbumChipClassName(isActive)}
                  >
                    {value === 'private' ? (
                      <Lock className="size-3" aria-hidden="true" />
                    ) : null}
                    {FILTER_LABELS[value]}
                    <span className="tabular-nums">{counts[value]}</span>
                  </button>
                )
              })}
            </div>

            {hasSuggestions && !isAtLimit ? (
              <button
                type="button"
                onClick={() => openCreate('suggestions')}
                className={cn(
                  'bg-primary/10 text-primary-text hover:bg-primary/15 focus-visible:ring-ring/50 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-[3px]',
                  TOUCH_BAND_CLASS
                )}
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                {getSuggestedAlbumsLabel(suggestionCount)}
              </button>
            ) : suggestions.state.status === 'loading' && !isAtLimit ? (
              // Holds the place of the chip, so the cards do not jump when it
              // arrives (at 320px it sits on a row of its own).
              <span
                aria-hidden="true"
                className="skeleton h-8 w-44 rounded-full"
              />
            ) : null}
          </div>

          <ul className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3 md:gap-x-4">
            {shown.map((album) => (
              <li key={album.id} className="min-w-0">
                <GalleryAlbumCard album={album} />
              </li>
            ))}
            {filter === 'all' && !isAtLimit ? (
              <li className="min-w-0">
                <button
                  type="button"
                  onClick={() => openCreate()}
                  className="text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:outline-primary flex aspect-[3/2] w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <Plus className="size-5" aria-hidden="true" />
                  New album
                </button>
              </li>
            ) : null}
          </ul>
          {shown.length === 0 ? (
            <p className="text-muted-foreground text-sm">No {filter} albums.</p>
          ) : null}
          {isAtLimit ? (
            <p className="text-muted-foreground text-sm">
              You have reached the limit of{' '}
              {formatInteger(MAX_GALLERY_ALBUMS_PER_ACTOR)} albums. Delete one
              to make a new one.
            </p>
          ) : null}
        </>
      )}

      {isCreateOpen && (
        <GalleryAlbumFormDialog
          open
          intent="create"
          ownerId={ownerId}
          suggestions={suggestions}
          initialTab={createTab}
          onOpenChange={setIsCreateOpen}
          onSaved={(albumId) =>
            router.push(`/gallery/albums/${encodeURIComponent(albumId)}`)
          }
        />
      )}
    </div>
  )
}
