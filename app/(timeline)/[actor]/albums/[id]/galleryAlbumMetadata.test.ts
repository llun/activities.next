import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryAlbumShare } from '@/lib/services/gallery/galleryAlbumEntities'

import {
  UNAVAILABLE_ALBUM_METADATA,
  buildGalleryAlbumMetadata
} from './galleryAlbumMetadata'

const PAGE_URL = 'https://llun.test/@ann@llun.test/albums/a1'

const share = (
  overrides: Partial<GalleryAlbumShare['album']> = {},
  facts: Partial<GalleryAlbumShare['facts']> = {}
): GalleryAlbumShare => {
  const album = buildAlbumCard('a1', { title: 'Kruger', ...overrides })
  return {
    album,
    facts: {
      photoCount: album.itemCount,
      speciesCount: 2,
      placeCount: 1,
      countryCount: 1,
      dayCount: 2,
      countryCodes: ['ZA'],
      countryName: 'South Africa',
      firstAt: album.firstAt,
      lastAt: album.lastAt,
      ...facts
    }
  }
}

const build = (value: GalleryAlbumShare, siteName = 'Llun') =>
  buildGalleryAlbumMetadata({
    share: value,
    ownerName: 'Ann',
    siteName,
    origin: 'https://llun.test',
    pageUrl: PAGE_URL
  })

describe('UNAVAILABLE_ALBUM_METADATA', () => {
  it('names nothing and asks not to be indexed', () => {
    expect(UNAVAILABLE_ALBUM_METADATA).toEqual({
      title: 'Album',
      robots: { index: false, follow: false }
    })
  })
})

describe('buildGalleryAlbumMetadata', () => {
  it('titles the card with the album and its owner', () => {
    const metadata = build(share())

    expect(metadata.title).toBe('Kruger · Ann')
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      title: 'Kruger · Ann',
      siteName: 'Llun',
      url: PAGE_URL
    })
    expect(metadata.alternates).toEqual({ canonical: PAGE_URL })
  })

  it('describes the visible photo count, dates, country and owner', () => {
    expect(build(share()).description).toBe(
      '3 photos · 12 – 19 Sep 2026 · South Africa · by Ann'
    )
  })

  it('says "1 photo" for one, and leaves out a country that is not single', () => {
    const metadata = build(
      share(
        {
          itemCount: 1,
          firstAt: '2026-09-12T10:00:00.000Z',
          lastAt: '2026-09-12T10:00:00.000Z'
        },
        { countryName: null, photoCount: 1 }
      )
    )

    expect(metadata.description).toBe('1 photo · 12 Sep 2026 · by Ann')
  })

  it('appends the album description, flattened and cut to 160 characters', () => {
    const long = `${'word '.repeat(60)}end`
    const metadata = build(share({ description: `  Two\n\nlines ${long}` }))

    const description = String(metadata.description)
    const [, text] = description.split(' — ')
    expect(text.startsWith('Two lines word')).toBeTrue()
    expect(text.length).toBeLessThanOrEqual(160)
    expect(text.endsWith('…')).toBeTrue()
    expect(metadata.openGraph?.description).toBe(description)
    expect(metadata.twitter?.description).toBe(description)
  })

  it('uses the full-size picture of a still as the card image', () => {
    const cover = buildGalleryItem('c1')
    cover.attachment.width = 4000
    cover.attachment.height = 3000
    const metadata = build(share({ cover }))

    expect(metadata.openGraph?.images).toEqual([
      {
        url: 'https://activities.local/media/c1.jpg',
        width: 4000,
        height: 3000,
        alt: 'Kruger'
      }
    ])
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' })
  })

  it('uses the stored thumbnail of a video, and a GIF, and resolves a relative one against the origin', () => {
    for (const mediaType of ['video/mp4', 'image/gif']) {
      const cover = buildGalleryItem('v1')
      cover.attachment.mediaType = mediaType
      cover.attachment.thumbnailUrl = '/media/v1-thumb.jpg'
      const metadata = build(share({ cover }))

      expect(metadata.openGraph?.images).toEqual([
        { url: 'https://llun.test/media/v1-thumb.jpg', alt: 'Kruger' }
      ])
    }
  })

  it('drops the image, and asks for a plain summary card, when the cover has none', () => {
    const noCover = build(share({ cover: null, previews: [] }))
    expect(noCover.openGraph?.images).toBeUndefined()
    expect(noCover.twitter).toMatchObject({ card: 'summary' })

    const video = buildGalleryItem('v2')
    video.attachment.mediaType = 'video/mp4'
    video.attachment.thumbnailUrl = undefined
    expect(build(share({ cover: video })).openGraph?.images).toBeUndefined()
  })

  it('drops an empty site name', () => {
    expect(build(share(), '  ').openGraph?.siteName).toBeUndefined()
  })

  it('is built from the share alone: nothing in it can name a photo outside it', () => {
    const metadata = build(share({ itemCount: 2 }))
    const text = JSON.stringify(metadata)

    expect(text).toContain('2 photos')
    // No item ids, no place names, no coordinates.
    expect(text).not.toMatch(/latitude|longitude|mediaId/)
  })
})
