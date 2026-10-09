import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'

export const buildSuggestion = (
  id: string,
  overrides: Partial<GalleryAlbumSuggestionEntity> = {}
): GalleryAlbumSuggestionEntity => ({
  id,
  kind: 'trip',
  title: 'Kruger, September 2026',
  photoCount: 3,
  firstAt: '2026-09-12T10:00:00.000Z',
  lastAt: '2026-09-19T10:00:00.000Z',
  preview: buildGalleryItem(`${id}-1`),
  mediaIds: [`${id}-1`, `${id}-2`, `${id}-3`],
  truncated: false,
  placeCount: 2,
  speciesCount: 3,
  activityCount: 0,
  ...overrides
})
