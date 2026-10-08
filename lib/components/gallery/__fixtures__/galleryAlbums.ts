import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type {
  GalleryAlbumCardEntity,
  GalleryAlbumDetailResponse
} from '@/lib/services/gallery/galleryAlbumEntities'

export const buildAlbumCard = (
  id: string,
  overrides: Partial<GalleryAlbumCardEntity> = {}
): GalleryAlbumCardEntity => {
  const cover = buildGalleryItem(`${id}-1`)
  return {
    id,
    title: `Album ${id}`,
    description: null,
    visibility: 'public',
    sortOrder: 'taken_desc',
    createdAt: Date.UTC(2026, 8, 1),
    updatedAt: Date.UTC(2026, 8, 2),
    itemCount: 3,
    firstAt: '2026-09-12T10:00:00.000Z',
    lastAt: '2026-09-19T10:00:00.000Z',
    cover,
    previews: [cover, buildGalleryItem(`${id}-2`), buildGalleryItem(`${id}-3`)],
    coverMediaId: null,
    hiddenPlaceCount: 0,
    ...overrides
  }
}

export const buildAlbumDetail = (
  overrides: Partial<GalleryAlbumDetailResponse> = {}
): GalleryAlbumDetailResponse => {
  const album = overrides.album ?? buildAlbumCard('a1', { title: 'Kruger' })
  return {
    album,
    facts: {
      photoCount: 3,
      speciesCount: 2,
      placeCount: 1,
      countryCount: 1,
      dayCount: 2,
      countryCodes: ['ZA'],
      countryName: 'South Africa',
      firstAt: album.firstAt,
      lastAt: album.lastAt
    },
    hiddenPlaceCount: 0,
    species: [
      { key: 'sci:panthera leo', name: 'African Lion', count: 2 },
      { key: 'sci:loxodonta africana', name: 'African Elephant', count: 1 }
    ],
    mediaIds: album.previews.map((item) => item.mediaId),
    storedItemCount: album.itemCount,
    page: {
      items: album.previews,
      nextMaxId: null
    },
    ...overrides
  }
}
