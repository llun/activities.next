'use client'

import { FolderOpen, Images, Lock, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { FC, useState } from 'react'

import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import {
  FITNESS_STAT_STRIP_CLASS,
  FitnessStatCell
} from '@/lib/components/fitness/FitnessStatCell'
import { FitnessStatGrid } from '@/lib/components/fitness/FitnessStatGrid'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { formatInteger } from '@/lib/fitness/calendar/format'
import type { GalleryAlbumListResponse } from '@/lib/services/gallery/galleryAlbumEntities'
import { MAX_GALLERY_ALBUMS_PER_ACTOR } from '@/lib/types/database/galleryAlbums'

import { GalleryAlbumCard } from './GalleryAlbumCard'
import { GalleryAlbumFormDialog } from './GalleryAlbumFormDialog'
import { getAlbumChipClassName } from './galleryAlbumsUi'

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

  const openCreate = () => setIsCreateOpen(true)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Albums"
        description="Group photos that belong together"
        actions={
          <Button
            onClick={openCreate}
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
        <FitnessEmptyState
          icon={FolderOpen}
          titleAs="h2"
          title="Group photos that belong together"
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus />
              Create your first album
            </Button>
          }
        >
          A trip, a species, a day out. An album never makes a photo more public
          than the post it came from.
        </FitnessEmptyState>
      ) : (
        <>
          <FitnessStatGrid
            variant="summary"
            columns={2}
            className={FITNESS_STAT_STRIP_CLASS}
          >
            <FitnessStatCell
              label="Albums"
              icon={FolderOpen}
              value={formatInteger(albums.length)}
            />
            <FitnessStatCell
              label="Photos in albums"
              icon={Images}
              value={formatInteger(photoCount)}
            />
          </FitnessStatGrid>

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
                  onClick={openCreate}
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
          onOpenChange={setIsCreateOpen}
          onSaved={(albumId) =>
            router.push(`/gallery/albums/${encodeURIComponent(albumId)}`)
          }
        />
      )}
    </div>
  )
}
