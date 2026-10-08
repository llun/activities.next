'use client'

import { Images } from 'lucide-react'
import { FC, useState } from 'react'

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
import type { GalleryMediaPage } from '@/lib/services/gallery/galleryEntities'
import {
  MEDIA_SUBJECT_CATEGORIES,
  type MediaSubjectCategory
} from '@/lib/types/database/gallery'

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

export const GalleryRecentView: FC<Props> = ({
  actorId,
  initialCategory,
  initialPage
}) => {
  const [filter, setFilter] = useState<Filter>(initialCategory ?? 'all')
  const startFilter = initialCategory ?? 'all'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recent"
        description="Your newest photos and videos first"
      />
      <SectionNavSelect
        label="Category"
        tabs={FILTER_TABS}
        active={filter}
        onChange={setFilter}
      />
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
      />
    </div>
  )
}
