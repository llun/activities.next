'use client'

import { Check, Folder, Link2 } from 'lucide-react'
import Link from 'next/link'
import { FC, useCallback, useRef, useState } from 'react'

import { GalleryAlbumHero } from '@/app/(timeline)/gallery/albums/GalleryAlbumHero'
import { GalleryAlbumSpeciesFilter } from '@/app/(timeline)/gallery/albums/GalleryAlbumSpeciesFilter'
import {
  ALBUM_SORT_LABELS,
  formatAlbumDateRange,
  getAlbumFactsParts
} from '@/app/(timeline)/gallery/albums/galleryAlbumsUi'
import { getAccountGalleryAlbum } from '@/lib/client'
import { BackLink } from '@/lib/components/back-link'
import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import { GalleryGrid } from '@/lib/components/gallery/GalleryGrid'
import { LoadMoreButton } from '@/lib/components/load-more-button/load-more-button'
import { profileBack } from '@/lib/components/navigation-history/backDestination'
import { Button } from '@/lib/components/ui/button'
import { Select } from '@/lib/components/ui/select'
import { useCopyToClipboard } from '@/lib/hooks/useCopyToClipboard'
import type { GalleryAlbumViewResponse } from '@/lib/services/gallery/galleryAlbumEntities'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import {
  GALLERY_ALBUM_SORTS,
  type GalleryAlbumSort
} from '@/lib/types/database/galleryAlbums'
import { cn } from '@/lib/utils'

interface Props {
  className?: string
  /** The album owner's actor id, for the paging calls. */
  ownerId: string
  /** Their display name (or handle), for the Back link and the byline. */
  ownerName: string
  /** `/@user@domain`. */
  profileHref: string
  /** The album's absolute public address, for Copy link. */
  pageUrl: string
  /** The first page, as the server rendered it for this viewer. */
  initial: GalleryAlbumViewResponse
  pageSize: number
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

/**
 * An album as a visitor sees it: the cover, title and date range, the
 * description, a facts line and the photos, which open in the lightbox with
 * public details only. Everything on it was computed on the server from the
 * photos this viewer may see; there is nothing to edit.
 */
export const PublicGalleryAlbumView: FC<Props> = ({
  className,
  ownerId,
  ownerName,
  profileHref,
  pageUrl,
  initial,
  pageSize
}) => {
  const { album, facts, species } = initial
  const { copied, copy } = useCopyToClipboard()

  const [items, setItems] = useState<GalleryItemEntity[]>(initial.items)
  const [nextMaxId, setNextMaxId] = useState<string | null>(initial.nextMaxId)
  const [sort, setSort] = useState<GalleryAlbumSort>(album.sortOrder)
  const [subject, setSubject] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Bumped by every new query, so a slow older answer is dropped.
  const generation = useRef(0)

  const fetchPage = useCallback(
    (nextSort: GalleryAlbumSort, nextSubject: string | null, cursor?: string) =>
      getAccountGalleryAlbum(ownerId, album.id, {
        limit: pageSize,
        sort: nextSort,
        subject: nextSubject ?? undefined,
        maxId: cursor
      }),
    [ownerId, album.id, pageSize]
  )

  // Replaces the grid with the first page of a new sort or species.
  const reload = async (
    nextSort: GalleryAlbumSort,
    nextSubject: string | null
  ) => {
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
  }

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

  const dateRange = formatAlbumDateRange(album.firstAt, album.lastAt)

  return (
    <div className={cn('space-y-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <BackLink
          href={profileHref}
          prefetch={false}
          {...profileBack(ownerName)}
        />
        <Button
          variant="outline"
          size="sm"
          className="pointer-coarse:h-10"
          onClick={() => void copy(pageUrl)}
        >
          {copied ? <Check /> : <Link2 />}
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
        <span role="status" className="sr-only">
          {copied ? 'Link copied.' : ''}
        </span>
      </div>

      <GalleryAlbumHero
        title={album.title}
        cover={album.cover}
        dateRange={dateRange}
        countryName={facts.countryName}
      />

      {album.description ? (
        <p className="text-sm break-words whitespace-pre-line">
          {album.description}
        </p>
      ) : null}

      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">
          {getAlbumFactsParts(facts).join(' · ')}
        </p>
        <p className="text-muted-foreground text-xs">
          By{' '}
          <Link
            href={profileHref}
            prefetch={false}
            className="hover:text-foreground underline-offset-2 hover:underline"
          >
            {ownerName}
          </Link>
        </p>
      </div>

      {album.itemCount === 0 ? (
        <FitnessEmptyState icon={Folder} titleAs="h2" title="Nothing to show" />
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
    </div>
  )
}
