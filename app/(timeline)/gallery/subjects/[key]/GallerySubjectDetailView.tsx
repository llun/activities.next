'use client'

import { Clock, Images, Sparkles } from 'lucide-react'
import { FC } from 'react'

import { BackLink } from '@/lib/components/back-link'
import { FITNESS_STAT_STRIP_CLASS } from '@/lib/components/fitness/FitnessStatCell'
import { FitnessStatCell } from '@/lib/components/fitness/FitnessStatCell'
import { FitnessStatGrid } from '@/lib/components/fitness/FitnessStatGrid'
import { GalleryPagedGrid } from '@/lib/components/gallery/GalleryPagedGrid'
import {
  GALLERY_CATEGORY_ICONS,
  GALLERY_CATEGORY_SINGULAR,
  formatGalleryDate
} from '@/lib/components/gallery/galleryCategories'
import { PageHeader } from '@/lib/components/page-header'
import type {
  GalleryMediaPage,
  GallerySubjectEntry
} from '@/lib/services/gallery/galleryEntities'

interface Props {
  actorId: string
  subject: Omit<GallerySubjectEntry, 'cover'>
  initialPage: GalleryMediaPage
}

export const GallerySubjectDetailView: FC<Props> = ({
  actorId,
  subject,
  initialPage
}) => {
  const name = subject.name ?? subject.scientificName ?? 'Unnamed subject'
  const CategoryIcon = subject.category
    ? GALLERY_CATEGORY_ICONS[subject.category]
    : null

  return (
    <div className="space-y-6">
      <BackLink href="/gallery" accessibleName="Back to subjects" />
      <PageHeader
        title={name}
        description={
          subject.name && subject.scientificName ? (
            <span className="italic">{subject.scientificName}</span>
          ) : undefined
        }
      />

      {subject.category ? (
        <p className="text-muted-foreground -mt-4 flex items-center gap-1.5 text-sm font-medium">
          {CategoryIcon ? (
            <CategoryIcon className="size-4" aria-hidden="true" />
          ) : null}
          {GALLERY_CATEGORY_SINGULAR[subject.category]}
        </p>
      ) : null}

      <FitnessStatGrid
        variant="summary"
        columns={3}
        className={FITNESS_STAT_STRIP_CLASS}
      >
        <FitnessStatCell
          label="First seen"
          icon={Sparkles}
          value={formatGalleryDate(subject.firstSeenAt) || null}
        />
        <FitnessStatCell
          label="Last seen"
          icon={Clock}
          value={formatGalleryDate(subject.lastSeenAt) || null}
        />
        <FitnessStatCell
          label="Photos"
          icon={Images}
          value={subject.count.toLocaleString('en-US')}
        />
      </FitnessStatGrid>

      <GalleryPagedGrid
        actorId={actorId}
        subject={subject.key}
        initialPage={initialPage}
      />
    </div>
  )
}
