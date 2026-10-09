'use client'

import Link from 'next/link'
import { FC } from 'react'

import {
  GallerySubjectCard,
  getGallerySubjectHref
} from '@/lib/components/gallery/GallerySubjectCard'
import {
  GALLERY_CATEGORY_ICONS,
  GALLERY_CATEGORY_LABELS,
  pluralize
} from '@/lib/components/gallery/galleryCategories'
import { Section } from '@/lib/components/surface/Section'
import type {
  GallerySubjectEntry,
  GallerySubjectGroupCategory
} from '@/lib/services/gallery/galleryEntities'

interface Props {
  category: GallerySubjectGroupCategory
  subjects: GallerySubjectEntry[]
  /** Link each card to its subject page (owner pages). */
  linkSubjects?: boolean
  /** Filter in place (profile tab). */
  onSelectSubject?: (key: string, label: string) => void
  /** "See all" target; omitted when there is nowhere to go. */
  seeAllHref?: string
  onSeeAll?: () => void
}

/**
 * A category heading with its icon and count over a grid of subject cards,
 * in the Fitness section style. Landscapes count photos, not species.
 */
export const GalleryCategorySection: FC<Props> = ({
  category,
  subjects,
  linkSubjects = false,
  onSelectSubject,
  seeAllHref,
  onSeeAll
}) => {
  const photos = subjects.reduce((total, subject) => total + subject.count, 0)
  const meta =
    category === 'landscape'
      ? pluralize(photos, 'photo')
      : pluralize(subjects.length, 'subject')
  const seeAllClass = 'text-primary-text text-sm font-medium hover:underline'
  return (
    <Section
      title={GALLERY_CATEGORY_LABELS[category]}
      icon={GALLERY_CATEGORY_ICONS[category]}
      meta={`· ${meta}`}
      actions={
        seeAllHref ? (
          <Link href={seeAllHref} prefetch={false} className={seeAllClass}>
            See all
          </Link>
        ) : onSeeAll ? (
          <button type="button" className={seeAllClass} onClick={onSeeAll}>
            See all
          </button>
        ) : undefined
      }
    >
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
        {subjects.map((subject) => (
          <li key={subject.key} className="min-w-0">
            <GallerySubjectCard
              subject={subject}
              href={
                linkSubjects ? getGallerySubjectHref(subject.key) : undefined
              }
              onSelect={onSelectSubject}
            />
          </li>
        ))}
      </ul>
    </Section>
  )
}
