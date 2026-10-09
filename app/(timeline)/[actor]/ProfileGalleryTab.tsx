'use client'

import {
  Bird,
  Camera,
  FolderOpen,
  Images,
  ListChecks,
  MapPin,
  X
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FC, useEffect, useState } from 'react'

import { GalleryAlbumCard } from '@/app/(timeline)/gallery/albums/GalleryAlbumCard'
import {
  getAccountGalleryAlbums,
  getGalleryLifeList,
  getGalleryMap,
  getGallerySubjects
} from '@/lib/client'
import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import { GalleryLifeListTable } from '@/lib/components/gallery/GalleryLifeListTable'
import { GalleryMap } from '@/lib/components/gallery/GalleryMap'
import { GalleryPagedGrid } from '@/lib/components/gallery/GalleryPagedGrid'
import { GallerySubjectsOverview } from '@/lib/components/gallery/GallerySubjectsOverview'
import { GALLERY_CATEGORY_LABELS } from '@/lib/components/gallery/galleryCategories'
import { formatGalleryMapSummary } from '@/lib/components/gallery/galleryTaxonomy'
import {
  SectionNavSelect,
  type SectionNavSelectTab
} from '@/lib/components/section-nav-select'
import { Button } from '@/lib/components/ui/button'
import type { GalleryAlbumListResponse } from '@/lib/services/gallery/galleryAlbumEntities'
import type {
  GalleryLifeListResponse,
  GalleryMapResponse,
  GallerySubjectGroupCategory,
  GallerySubjectsResponse,
  GallerySubview
} from '@/lib/services/gallery/galleryEntities'
import type { MediaSubjectCategory } from '@/lib/types/database/gallery'
import type { PublicMapProvider } from '@/lib/utils/mapProvider'

interface Props {
  actorId: string
  /**
   * `@user@domain`, for links to the posts behind map points. Without it the
   * map offers no "Open photo" action.
   */
  handle?: string
  /** Which subviews this viewer may open; never empty when rendered. */
  subviews: GallerySubview[]
  isCurrentUser?: boolean
  mapProvider: PublicMapProvider
}

const SUBVIEW_TABS: Record<
  GallerySubview,
  SectionNavSelectTab<GallerySubview>
> = {
  subjects: { id: 'subjects', label: 'Subjects', icon: Bird },
  recent: { id: 'recent', label: 'Recent', icon: Images },
  albums: { id: 'albums', label: 'Albums', icon: FolderOpen },
  map: { id: 'map', label: 'Map', icon: MapPin },
  'life-list': { id: 'life-list', label: 'Life list', icon: ListChecks }
}

type Loaded<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: T }

// Loads once per mount. The panels are keyed by subview, so switching view
// remounts and refetches.
const useGalleryLoad = <T,>(load: () => Promise<T>, fallback: string) => {
  const [result, setResult] = useState<Loaded<T>>({ state: 'loading' })
  useEffect(() => {
    let cancelled = false
    load().then(
      (data) => {
        if (!cancelled) setResult({ state: 'ready', data })
      },
      (error: unknown) => {
        if (cancelled) return
        setResult({
          state: 'error',
          message: error instanceof Error ? error.message : fallback
        })
      }
    )
    return () => {
      cancelled = true
    }
    // The panel is remounted for a different actor or view.
  }, [])
  return result
}

const PanelSkeleton: FC = () => (
  <div aria-busy="true" className="space-y-3">
    <span className="sr-only">Loading gallery</span>
    <div aria-hidden="true" className="skeleton h-16 w-full rounded-lg" />
    <div
      aria-hidden="true"
      className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="skeleton aspect-square rounded-lg" />
      ))}
    </div>
  </div>
)

const PanelError: FC<{ message: string }> = ({ message }) => (
  <p role="alert" className="text-destructive py-6 text-center text-sm">
    {message}
  </p>
)

const FilterChip: FC<{
  label: string
  clearLabel: string
  onClear: () => void
}> = ({ label, clearLabel, onClear }) => (
  <div className="flex items-center gap-2">
    <span className="bg-muted inline-flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-sm font-medium">
      {label}
      <button
        type="button"
        aria-label={clearLabel}
        className="hover:bg-background focus-visible:outline-primary rounded-full p-1 focus-visible:outline-2"
        onClick={onClear}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  </div>
)

const SubjectsPanel: FC<{
  actorId: string
  onSelectSubject: (key: string, label: string) => void
  onSeeAll: (category: GallerySubjectGroupCategory) => void
  onOpenMap?: () => void
}> = ({ actorId, onSelectSubject, onSeeAll, onOpenMap }) => {
  const result = useGalleryLoad<GallerySubjectsResponse>(
    () => getGallerySubjects(actorId),
    'Failed to load subjects.'
  )
  if (result.state === 'loading') return <PanelSkeleton />
  if (result.state === 'error') return <PanelError message={result.message} />
  return (
    <GallerySubjectsOverview
      data={result.data}
      onSelectSubject={onSelectSubject}
      onSeeAll={onSeeAll}
      onOpenMap={onOpenMap}
    />
  )
}

const LifeListPanel: FC<{
  actorId: string
  onSelectSubject: (key: string, label: string) => void
}> = ({ actorId, onSelectSubject }) => {
  const result = useGalleryLoad<GalleryLifeListResponse | null>(
    () => getGalleryLifeList(actorId),
    'Failed to load the life list.'
  )
  if (result.state === 'loading') return <PanelSkeleton />
  if (result.state === 'error') return <PanelError message={result.message} />
  if (!result.data || result.data.entries.length === 0) {
    return <FitnessEmptyState icon={ListChecks} title="No life list to show" />
  }
  return (
    <GalleryLifeListTable
      data={result.data}
      onSelectSubject={onSelectSubject}
    />
  )
}

// The owner's own list holds their private albums too (with a Private badge on
// the card), and a private album has no public page, so each card opens the
// owner's album page, which has the Share hint and the controls. A visitor's
// cards open the public page.
const AlbumsPanel: FC<{
  actorId: string
  handle: string
  isCurrentUser: boolean
}> = ({ actorId, handle, isCurrentUser }) => {
  const result = useGalleryLoad<GalleryAlbumListResponse>(
    () => getAccountGalleryAlbums(actorId),
    'Failed to load albums.'
  )
  if (result.state === 'loading') return <PanelSkeleton />
  if (result.state === 'error') return <PanelError message={result.message} />
  if (result.data.albums.length === 0) {
    return <FitnessEmptyState icon={FolderOpen} title="No albums to show" />
  }
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-3 md:gap-x-4">
      {result.data.albums.map((album) => (
        <li key={album.id} className="min-w-0">
          <GalleryAlbumCard
            album={album}
            href={
              isCurrentUser
                ? `/gallery/albums/${encodeURIComponent(album.id)}`
                : `/${handle}/albums/${encodeURIComponent(album.id)}`
            }
          />
        </li>
      ))}
    </ul>
  )
}

const MapPanel: FC<{
  actorId: string
  handle?: string
  mapProvider: PublicMapProvider
}> = ({ actorId, handle, mapProvider }) => {
  const router = useRouter()
  const result = useGalleryLoad<GalleryMapResponse | null>(
    () => getGalleryMap(actorId),
    'Failed to load the map.'
  )
  if (result.state === 'loading') return <PanelSkeleton />
  if (result.state === 'error') return <PanelError message={result.message} />
  // A private map (null) renders GalleryMap's own empty state.
  const points = result.data?.points ?? []
  // Without a handle there is no post URL to build, so the card offers no
  // "Open photo" action rather than pushing a protocol-relative `//<id>`.
  const openPost = (mediaId: string) => {
    if (!handle) return
    const point = points.find((entry) => entry.mediaId === mediaId)
    if (!point) return
    router.push(`/${handle}/${encodeURIComponent(point.statusId)}`)
  }
  return (
    <div className="space-y-3">
      {points.length > 0 ? (
        <p className="text-muted-foreground text-sm">
          {formatGalleryMapSummary(points.length, result.data?.countryCount)}
        </p>
      ) : null}
      <GalleryMap
        points={points}
        mapProvider={mapProvider}
        onSelect={handle ? openPost : undefined}
      />
    </div>
  )
}

/**
 * The profile's Gallery tab. A `SectionNavSelect` switches between the
 * subviews the viewer may open; choosing a subject (or "See all" on a
 * category) filters the grid in place with a chip to go back.
 */
export const ProfileGalleryTab: FC<Props> = ({
  actorId,
  handle,
  subviews: offeredSubviews,
  isCurrentUser = false,
  mapProvider
}) => {
  // An album opens at `/<handle>/albums/<id>`, which needs the handle.
  const subviews = handle
    ? offeredSubviews
    : offeredSubviews.filter((id) => id !== 'albums')
  const [view, setView] = useState<GallerySubview>(subviews[0] ?? 'subjects')
  const [subject, setSubject] = useState<{
    key: string
    label: string
  } | null>(null)
  const [category, setCategory] = useState<MediaSubjectCategory | null>(null)

  const tabs = subviews.map((id) => SUBVIEW_TABS[id])
  const activeView = subviews.includes(view)
    ? view
    : (subviews[0] ?? 'subjects')

  const changeView = (next: GallerySubview) => {
    setView(next)
    setSubject(null)
    setCategory(null)
  }

  const selectSubject = (key: string, label: string) =>
    setSubject({ key, label })
  const seeAll = (next: GallerySubjectGroupCategory) => {
    if (next === 'unidentified') return
    setCategory(next)
    setSubject(null)
    setView('recent')
  }

  const renderBody = () => {
    if (subject !== null) {
      return (
        <div className="space-y-4">
          <FilterChip
            label={subject.label}
            clearLabel="Back to all subjects"
            onClear={() => setSubject(null)}
          />
          <GalleryPagedGrid
            key={`subject:${subject.key}`}
            actorId={actorId}
            subject={subject.key}
          />
        </div>
      )
    }
    switch (activeView) {
      case 'subjects':
        return (
          <SubjectsPanel
            actorId={actorId}
            onSelectSubject={selectSubject}
            onSeeAll={seeAll}
            onOpenMap={
              subviews.includes('map') ? () => changeView('map') : undefined
            }
          />
        )
      case 'recent':
        return (
          <div className="space-y-4">
            {category ? (
              <FilterChip
                label={GALLERY_CATEGORY_LABELS[category]}
                clearLabel="Show all photos and videos"
                onClear={() => setCategory(null)}
              />
            ) : null}
            <GalleryPagedGrid
              key={`recent:${category ?? 'all'}`}
              actorId={actorId}
              category={category ?? undefined}
            />
          </div>
        )
      case 'albums':
        return handle ? (
          <AlbumsPanel
            actorId={actorId}
            handle={handle}
            isCurrentUser={isCurrentUser}
          />
        ) : null
      case 'map':
        return (
          <MapPanel
            actorId={actorId}
            handle={handle}
            mapProvider={mapProvider}
          />
        )
      case 'life-list':
        return (
          <LifeListPanel actorId={actorId} onSelectSubject={selectSubject} />
        )
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {tabs.length > 1 ? (
          <SectionNavSelect
            label="Gallery views"
            tabs={tabs}
            active={activeView}
            onChange={changeView}
          />
        ) : (
          <span />
        )}
        {isCurrentUser ? (
          <Button variant="outline" asChild>
            <Link href="/gallery">
              <Camera className="size-4" aria-hidden="true" />
              Gallery
            </Link>
          </Button>
        ) : null}
      </div>
      {renderBody()}
    </div>
  )
}
