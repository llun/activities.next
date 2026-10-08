'use client'

import Link from 'next/link'
import { FC } from 'react'

import { Media } from '@/lib/components/posts/media'
import type { GallerySubjectEntry } from '@/lib/services/gallery/galleryEntities'

interface Props {
  subject: GallerySubjectEntry
  /** Owner pages link to the subject page. */
  href?: string
  /** The profile tab filters in place instead of navigating. */
  onSelect?: (key: string, label: string) => void
}

const CARD_CLASS =
  'group focus-visible:outline-primary block w-full min-w-0 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2'

const CardBody: FC<{ subject: GallerySubjectEntry }> = ({ subject }) => {
  const { cover } = subject
  const name = subject.name ?? subject.scientificName ?? 'Unnamed subject'
  const attachment = cover.attachment.thumbnailUrl
    ? {
        ...cover.attachment,
        mediaType: 'image/jpeg',
        url: cover.attachment.thumbnailUrl
      }
    : cover.attachment
  return (
    <>
      <span className="bg-muted/20 relative block aspect-square overflow-hidden rounded-lg">
        <Media
          attachment={attachment}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        />
        <span className="absolute right-1.5 bottom-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">
          <span aria-hidden="true">{subject.count}</span>
          <span className="sr-only">
            {subject.count} {subject.count === 1 ? 'photo' : 'photos'}
          </span>
        </span>
      </span>
      <span className="mt-1.5 block truncate text-sm font-medium">{name}</span>
      {subject.scientificName && subject.name ? (
        <span className="text-muted-foreground block truncate text-xs italic">
          {subject.scientificName}
        </span>
      ) : null}
    </>
  )
}

/**
 * One subject: its newest photo, name, scientific name in italics and photo
 * count. A link on owner pages, a button that filters in place elsewhere.
 * Repeats per row, so the link never prefetches.
 */
export const GallerySubjectCard: FC<Props> = ({ subject, href, onSelect }) => {
  if (href) {
    return (
      <Link href={href} prefetch={false} className={CARD_CLASS}>
        <CardBody subject={subject} />
      </Link>
    )
  }
  return (
    <button
      type="button"
      className={CARD_CLASS}
      onClick={() =>
        onSelect?.(
          subject.key,
          subject.name ?? subject.scientificName ?? 'Unnamed subject'
        )
      }
    >
      <CardBody subject={subject} />
    </button>
  )
}

export const getGallerySubjectHref = (key: string) =>
  `/gallery/subjects/${encodeURIComponent(key)}`
