'use client'

import { FC } from 'react'

import { GallerySubjectsOverview } from '@/lib/components/gallery/GallerySubjectsOverview'
import { PageHeader } from '@/lib/components/page-header'
import type { GallerySubjectsResponse } from '@/lib/services/gallery/galleryEntities'

interface Props {
  data: GallerySubjectsResponse
}

export const GallerySubjectsView: FC<Props> = ({ data }) => (
  <div className="space-y-6">
    <PageHeader
      title="Subjects"
      description="Grouped by what each photo or video shows"
    />
    <GallerySubjectsOverview
      data={data}
      linkSubjects
      getSeeAllHref={(category) =>
        `/gallery/recent?category=${encodeURIComponent(category)}`
      }
    />
  </div>
)
