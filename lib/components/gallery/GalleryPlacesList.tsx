'use client'

import { FC, useId, useState } from 'react'

import { formatGalleryDate } from '@/lib/components/gallery/galleryCategories'
import {
  type GalleryPlaceGroup,
  groupPointsByPlace
} from '@/lib/components/gallery/galleryPlaces'
import type { GalleryMapPoint } from '@/lib/services/gallery/galleryEntities'

interface Props {
  points: readonly GalleryMapPoint[]
  /**
   * Opens one photo. With it, each place expands to list its photos; without
   * it the list is read-only.
   */
  onOpen?: (mediaId: string) => void
}

interface PlaceRowProps {
  place: GalleryPlaceGroup
  meta: string
  onOpen?: (mediaId: string) => void
}

const PlaceRow: FC<PlaceRowProps> = ({ place, meta, onOpen }) => {
  const [isOpen, setIsOpen] = useState(false)
  const listId = useId()
  const summary = (
    <>
      <div className="flex shrink-0 -space-x-3" aria-hidden="true">
        {place.thumbnails.map((thumbnail) => (
          <img
            key={thumbnail}
            src={thumbnail}
            alt=""
            className="border-background size-10 rounded-md border-2 object-cover"
          />
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{place.name}</p>
        {meta ? (
          <p className="text-muted-foreground truncate text-xs">{meta}</p>
        ) : null}
      </div>
      <span className="text-sm font-semibold tabular-nums">
        {place.count}
        <span className="sr-only">
          {place.count === 1 ? ' photo or video' : ' photos and videos'}
        </span>
      </span>
    </>
  )
  const rowClass = 'flex w-full items-center gap-3 px-3 py-2.5 text-left'

  return (
    <li>
      {onOpen ? (
        <button
          type="button"
          className={`${rowClass} hover:bg-muted`}
          aria-expanded={isOpen}
          aria-controls={listId}
          onClick={() => setIsOpen((open) => !open)}
        >
          {summary}
        </button>
      ) : (
        <div className={rowClass}>{summary}</div>
      )}
      {onOpen && isOpen ? (
        <ul id={listId} className="bg-muted/40 divide-y border-t">
          {place.points.map((point) => (
            <li key={point.mediaId}>
              <button
                type="button"
                className="hover:bg-muted w-full truncate px-6 py-2 text-left text-sm"
                onClick={() => onOpen(point.mediaId)}
              >
                {point.subjectName ?? 'Photo or video'}
                {point.takenAt ? ` · ${formatGalleryDate(point.takenAt)}` : ''}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * The places on the map as a plain list: place name, a few stacked thumbnails,
 * a short meta line and the number of photos. It is the accessible twin of the
 * map, so a reader who cannot use the canvas still gets every place and count.
 */
export const GalleryPlacesList: FC<Props> = ({ points, onOpen }) => {
  const headingId = useId()
  const places = groupPointsByPlace(points)
  if (places.length === 0) return null

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-base font-semibold">
        Places
      </h2>
      <ul className="divide-y rounded-lg border">
        {places.map((place) => {
          const lastDate = formatGalleryDate(place.lastTakenAt)
          const meta = [
            place.subjectCount > 0
              ? `${place.subjectCount} ${place.subjectCount === 1 ? 'subject' : 'subjects'}`
              : null,
            lastDate ? `last ${lastDate}` : null
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <PlaceRow
              key={place.name}
              place={place}
              meta={meta}
              onOpen={onOpen}
            />
          )
        })}
      </ul>
    </section>
  )
}
