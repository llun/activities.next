'use client'

import { ListChecks } from 'lucide-react'
import { FC } from 'react'

import { FitnessEmptyState } from '@/lib/components/fitness/FitnessEmptyState'
import { GalleryLifeListTable } from '@/lib/components/gallery/GalleryLifeListTable'
import { PageHeader } from '@/lib/components/page-header'
import type { GalleryLifeListResponse } from '@/lib/services/gallery/galleryEntities'

interface Props {
  data: GalleryLifeListResponse
}

export const GalleryLifeListView: FC<Props> = ({ data }) => (
  <div className="space-y-6">
    <PageHeader
      title="Life list"
      description="Every species you have photographed, first sighting first"
    />
    {data.entries.length > 0 ? (
      <GalleryLifeListTable data={data} linkSubjects />
    ) : (
      <FitnessEmptyState icon={ListChecks} title="No species yet">
        Name the subject of a photo in its details and it joins your life list.
      </FitnessEmptyState>
    )}
  </div>
)
