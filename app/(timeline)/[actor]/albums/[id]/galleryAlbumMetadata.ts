import { Metadata } from 'next'

import { formatAlbumDateRange } from '@/app/(timeline)/gallery/albums/galleryAlbumsUi'
import { pluralize } from '@/lib/components/gallery/galleryCategories'
import type { GalleryAlbumShare } from '@/lib/services/gallery/galleryAlbumEntities'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'

/**
 * What an album that a logged-out visitor cannot open (private, missing, or
 * with nothing public in it) gets. It names nothing: the same few words for all
 * three, and no card, so a link preview cannot tell them apart or say what is
 * behind the address.
 */
export const UNAVAILABLE_ALBUM_METADATA: Metadata = {
  title: 'Album',
  robots: { index: false, follow: false }
}

// Descriptions beyond this are cut for a card; the page shows the whole text.
const MAX_DESCRIPTION_LENGTH = 160

const FULL_SIZE_TYPES = /^image\/(?!gif$)/

const toAbsoluteUrl = (url: string, origin: string): string | null => {
  try {
    return new URL(url, origin).toString()
  } catch {
    return null
  }
}

/**
 * The card image: the full-size picture of a still (a link preview wants more
 * than the small thumbnail), the stored thumbnail of a video or animation.
 * Null when there is nothing a crawler can render.
 */
const getCardImage = (
  cover: GalleryItemEntity | null,
  origin: string,
  alt: string
): { url: string; width?: number; height?: number; alt: string } | null => {
  if (!cover) return null
  const { attachment } = cover
  const isStill = FULL_SIZE_TYPES.test(attachment.mediaType)
  const source = isStill ? attachment.url : attachment.thumbnailUrl
  const url = source ? toAbsoluteUrl(source, origin) : null
  if (!url) return null
  const hasSize =
    isStill &&
    typeof attachment.width === 'number' &&
    typeof attachment.height === 'number' &&
    attachment.width > 0 &&
    attachment.height > 0
  return {
    url,
    ...(hasSize ? { width: attachment.width, height: attachment.height } : {}),
    alt
  }
}

const truncate = (text: string): string =>
  text.length <= MAX_DESCRIPTION_LENGTH
    ? text
    : `${text.slice(0, MAX_DESCRIPTION_LENGTH - 1).trimEnd()}…`

export interface BuildGalleryAlbumMetadataParams {
  share: GalleryAlbumShare
  /** The album owner's display name, or their handle when they have none. */
  ownerName: string
  siteName: string
  /** The actor's own origin, for relative media URLs. */
  origin: string
  /** The album's public address. */
  pageUrl: string
}

/**
 * The title, description, cover and photo count of an album's link preview.
 *
 * Everything comes from `share`, which is computed for the logged-out audience
 * alone: the count is the number of photos a logged-out visitor can open, the
 * date range is theirs, and the cover is one of those photos. Nothing here
 * reads the viewer, so a signed-in owner, a follower or a crawler get the same
 * tags, and none of them can carry a photo, place or date the public view
 * hides.
 */
export const buildGalleryAlbumMetadata = ({
  share,
  ownerName,
  siteName,
  origin,
  pageUrl
}: BuildGalleryAlbumMetadataParams): Metadata => {
  const { album, facts } = share
  const title = `${album.title} · ${ownerName}`
  const summary = [
    pluralize(album.itemCount, 'photo'),
    formatAlbumDateRange(album.firstAt, album.lastAt),
    facts.countryName,
    `by ${ownerName}`
  ]
    .filter(Boolean)
    .join(' · ')
  const description = album.description
    ? `${summary} — ${truncate(album.description.replace(/\s+/g, ' ').trim())}`
    : summary
  const image = getCardImage(album.cover, origin, album.title)
  const images = image ? [image] : undefined

  return {
    title,
    description,
    alternates: { canonical: pageUrl },
    openGraph: {
      type: 'website',
      title,
      description,
      // An operator can blank the instance name; an empty og:site_name is worse
      // than none, so drop the tag rather than emit it empty.
      siteName: siteName.trim() || undefined,
      url: pageUrl,
      images
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title,
      description,
      images
    }
  }
}
