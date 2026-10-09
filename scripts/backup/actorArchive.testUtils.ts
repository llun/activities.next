import { Attachment } from '@/lib/types/domain/attachment'

export const buildAttachment = (
  overrides: Partial<Attachment> = {}
): Attachment => ({
  id: 'attachment-1',
  actorId: 'https://example.test/users/alice',
  statusId: 'status-1',
  type: 'Document',
  mediaType: 'image/jpeg',
  url: 'https://example.test/api/v1/files/ab/cd.webp',
  name: 'a photo',
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})
