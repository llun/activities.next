import { FC, useId } from 'react'

import { formatGalleryDate } from '@/lib/components/gallery/galleryCategories'
import { groupPointsByPlace } from '@/lib/components/gallery/galleryPlaces'
import type { GalleryMapPoint } from '@/lib/services/gallery/galleryEntities'

interface Props {
  points: readonly GalleryMapPoint[]
}

/**
 * The places on the map as a plain list: place name, a few stacked thumbnails,
 * a short meta line and the number of photos. It is the accessible twin of the
 * map, so a reader who cannot use the canvas still gets every place and count.
 */
export const GalleryPlacesList: FC<Props> = ({ points }) => {
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
            <li
              key={place.name}
              className="flex items-center gap-3 px-3 py-2.5"
            >
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
                  <p className="text-muted-foreground truncate text-xs">
                    {meta}
                  </p>
                ) : null}
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {place.count}
                <span className="sr-only">
                  {place.count === 1 ? ' photo or video' : ' photos and videos'}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
