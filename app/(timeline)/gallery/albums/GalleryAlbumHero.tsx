import { FC } from 'react'

import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'

import { GalleryAlbumThumb } from './GalleryAlbumThumb'

interface Props {
  title: string
  // The cover the viewer can see; without one the title stands alone.
  cover: GalleryItemEntity | null
  // "12 – 19 Sep 2026", empty when no photo is dated.
  dateRange: string
  // Set when the visible places are all in one country.
  countryName: string | null
}

/**
 * The top of an album page: the cover with the title and date range over it, or
 * a plain heading when no photo is visible. Shared by the owner's page and the
 * public one.
 */
export const GalleryAlbumHero: FC<Props> = ({
  title,
  cover,
  dateRange,
  countryName
}) => {
  const subtitle = dateRange
    ? `${dateRange}${countryName ? ` · ${countryName}` : ''}`
    : null

  if (!cover) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="bg-muted/40 relative aspect-[4/3] w-full overflow-hidden rounded-xl border sm:aspect-[16/7]">
      <GalleryAlbumThumb item={cover} loading="eager" quality="full" />
      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/75 via-black/30 to-transparent p-4 text-white sm:p-6">
        <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-white/85">{subtitle}</p>
        ) : null}
      </div>
    </div>
  )
}
