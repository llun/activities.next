import type {
  GalleryItemEntity,
  GalleryLifeListEntry,
  GallerySubjectEntry
} from '@/lib/services/gallery/galleryEntities'
import type { MediaSubjectCategory } from '@/lib/types/database/gallery'

const TIME = new Date('2025-03-14T09:30:00.000Z').getTime()

export const buildGalleryItem = (
  mediaId: string,
  overrides: Partial<GalleryItemEntity> = {}
): GalleryItemEntity => ({
  mediaId,
  statusId: `status-${mediaId}`,
  attachment: {
    id: `attachment-${mediaId}`,
    actorId: 'https://activities.local/users/llun',
    statusId: `https://activities.local/users/llun/statuses/${mediaId}`,
    type: 'Document',
    mediaType: 'image/jpeg',
    url: `https://activities.local/media/${mediaId}.jpg`,
    thumbnailUrl: `https://activities.local/media/${mediaId}-thumb.jpg`,
    mediaId,
    name: '',
    createdAt: TIME,
    updatedAt: TIME
  },
  subject: null,
  takenAt: '2025-03-14T09:30:00.000Z',
  camera: null,
  lens: null,
  exposure: null,
  place: null,
  ...overrides
})

export const buildGallerySubject = (
  key: string,
  overrides: Partial<GallerySubjectEntry> = {}
): GallerySubjectEntry => ({
  key,
  name: 'Keel-billed Toucan',
  scientificName: 'Ramphastos sulfuratus',
  category: 'bird' as MediaSubjectCategory,
  count: 2,
  firstSeenAt: '2025-03-14T09:30:00.000Z',
  lastSeenAt: '2025-03-16T09:30:00.000Z',
  cover: buildGalleryItem(`cover-${key}`),
  ...overrides
})

export const buildLifeListEntry = (
  key: string,
  overrides: Partial<GalleryLifeListEntry> = {}
): GalleryLifeListEntry => {
  const { cover, ...entry } = buildGallerySubject(key)
  return { ...entry, coverMediaId: cover.mediaId, ...overrides }
}
