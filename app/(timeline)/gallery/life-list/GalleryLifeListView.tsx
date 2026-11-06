'use client'

import { ListChecks } from 'lucide-react'
import { FC } from 'react'

import { GalleryLifeListTable } from '@/lib/components/gallery/GalleryLifeListTable'
import { PageHeader } from '@/lib/components/page-header'
import { EmptyState } from '@/lib/components/surface/EmptyState'
import type { GalleryLifeListResponse } from '@/lib/services/gallery/galleryEntities'

interface Props {
  data: GalleryLifeListResponse
}

export const GalleryLifeListView: FC<Props> = ({ data }) => (
  <div className="space-y-6">
    <PageHeader
      title="Life list"
      description="Every identified subject, first sighting first"
    />
    {data.entries.length > 0 ? (
      <GalleryLifeListTable data={data} linkSubjects />
    ) : (
      <EmptyState icon={ListChecks} title="No subjects yet">
        Name the subject of a photo in its details and it joins your life list.
      </EmptyState>
    )}
  </div>
)
