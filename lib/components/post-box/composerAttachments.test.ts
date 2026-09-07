import { describe, expect, it } from 'vitest'

import { Attachment, PostBoxAttachment } from '@/lib/types/domain/attachment'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import {
  UpdateNoteMediaAttachment,
  areAttachmentIdsEqualInOrder,
  getAttachmentIds,
  getEditableStatusAttachments,
  getMediaAttachmentDimensions,
  getMediaTypeFromMastodonAttachment,
  getPreservedStatusAttachments,
  getStatusAttachmentsFromUpdateResponse,
  getTimestamp,
  isEditableStatusMediaAttachment
} from './composerAttachments'

describe('composerAttachments', () => {
  const mediaAttachment1: Attachment = {
    id: 'att-1',
    actorId: 'actor-1',
    statusId: 'status-1',
    type: 'Document',
    mediaType: 'image/jpeg',
    url: 'https://activities.local/files/photo1.jpg',
    width: 800,
    height: 600,
    name: 'Photo 1',
    mediaId: 'media-1',
    createdAt: 1000,
    updatedAt: 1000
  }

  const mediaAttachment2: Attachment = {
    id: 'att-2',
    actorId: 'actor-1',
    statusId: 'status-1',
    type: 'Document',
    mediaType: 'image/png',
    url: 'https://activities.local/files/photo2.png',
    width: 1024,
    height: 768,
    name: 'Photo 2',
    mediaId: 'media-2',
    createdAt: 1100,
    updatedAt: 1100
  }

  const fitnessAttachment: Attachment = {
    id: 'att-fitness',
    actorId: 'actor-1',
    statusId: 'status-1',
    type: 'Document',
    mediaType: 'application/vnd.antigravity.fitness+json',
    url: 'https://activities.local/fitness/run.fit',
    name: 'Morning Run',
    mediaId: 'media-fitness',
    createdAt: 1000,
    updatedAt: 1000
  }

  const unsupportedAttachment: Attachment = {
    id: 'att-unsupported',
    actorId: 'actor-1',
    statusId: 'status-1',
    type: 'Document',
    mediaType: 'application/pdf',
    url: 'https://activities.local/files/document.pdf',
    name: 'Document.pdf',
    createdAt: 1000,
    updatedAt: 1000
  }

  describe('isEditableStatusMediaAttachment', () => {
    it('returns true when attachment has mediaId and is not a fitness file', () => {
      expect(isEditableStatusMediaAttachment(mediaAttachment1)).toBe(true)
    })

    it('returns false for fitness attachments even with mediaId', () => {
      expect(isEditableStatusMediaAttachment(fitnessAttachment)).toBe(false)
    })

    it('returns false when mediaId is missing or null', () => {
      expect(isEditableStatusMediaAttachment(unsupportedAttachment)).toBe(false)
      expect(
        isEditableStatusMediaAttachment({
          ...mediaAttachment1,
          mediaId: undefined
        })
      ).toBe(false)
    })
  })

  describe('getEditableStatusAttachments', () => {
    it('extracts editable media attachments with mediaId as id', () => {
      const status = {
        id: 'status-1',
        text: 'Hello world',
        summary: null,
        attachments: [
          mediaAttachment1,
          fitnessAttachment,
          unsupportedAttachment
        ],
        createdAt: 1000,
        updatedAt: 1000,
        reply: '',
        type: StatusType.enum.Note
      } as unknown as EditableStatus

      const editableAttachments = getEditableStatusAttachments(status)
      expect(editableAttachments).toEqual([
        {
          type: 'upload',
          id: 'media-1',
          mediaType: 'image/jpeg',
          url: 'https://activities.local/files/photo1.jpg',
          width: 800,
          height: 600,
          name: 'Photo 1'
        }
      ])
    })

    it('defaults width and height to 0 when missing', () => {
      const attachmentWithoutDimensions: Attachment = {
        ...mediaAttachment1,
        width: undefined,
        height: undefined
      }
      const status = {
        id: 'status-1',
        text: 'Post',
        summary: null,
        attachments: [attachmentWithoutDimensions],
        createdAt: 1000,
        updatedAt: 1000,
        reply: '',
        type: StatusType.enum.Note
      } as unknown as EditableStatus

      const extracted = getEditableStatusAttachments(status)
      expect(extracted[0].width).toBe(0)
      expect(extracted[0].height).toBe(0)
    })
  })

  describe('getPreservedStatusAttachments', () => {
    it('preserves fitness and unsupported attachments while excluding editable media attachments', () => {
      const attachments: Attachment[] = [
        mediaAttachment1,
        fitnessAttachment,
        unsupportedAttachment,
        mediaAttachment2
      ]

      const preserved = getPreservedStatusAttachments(attachments)
      expect(preserved).toEqual([fitnessAttachment, unsupportedAttachment])
    })

    it('returns empty array when all attachments are editable media', () => {
      expect(
        getPreservedStatusAttachments([mediaAttachment1, mediaAttachment2])
      ).toEqual([])
    })
  })

  describe('attachment order and comparison', () => {
    const itemA: Pick<PostBoxAttachment, 'id'> = { id: 'a' }
    const itemB: Pick<PostBoxAttachment, 'id'> = { id: 'b' }
    const itemC: Pick<PostBoxAttachment, 'id'> = { id: 'c' }

    it('extracts attachment IDs in order', () => {
      expect(getAttachmentIds([itemA, itemB, itemC])).toEqual(['a', 'b', 'c'])
    })

    it('returns true when attachment IDs are in exact identical order', () => {
      expect(areAttachmentIdsEqualInOrder([itemA, itemB], [itemA, itemB])).toBe(
        true
      )
    })

    it('returns false when attachments have the same IDs in different order', () => {
      expect(areAttachmentIdsEqualInOrder([itemA, itemB], [itemB, itemA])).toBe(
        false
      )
    })

    it('returns false when lengths differ', () => {
      expect(areAttachmentIdsEqualInOrder([itemA], [itemA, itemB])).toBe(false)
      expect(areAttachmentIdsEqualInOrder([itemA, itemB], [itemA])).toBe(false)
    })

    it('returns false when IDs differ', () => {
      expect(areAttachmentIdsEqualInOrder([itemA, itemB], [itemA, itemC])).toBe(
        false
      )
    })

    it('returns true for two empty lists', () => {
      expect(areAttachmentIdsEqualInOrder([], [])).toBe(true)
    })
  })

  describe('getTimestamp', () => {
    it('returns finite number timestamp', () => {
      expect(getTimestamp(12345, 999)).toBe(12345)
    })

    it('parses valid ISO string', () => {
      const time = Date.parse('2026-09-07T12:00:00Z')
      expect(getTimestamp('2026-09-07T12:00:00Z', 999)).toBe(time)
    })

    it('extracts time from Date object', () => {
      const date = new Date(1234567890)
      expect(getTimestamp(date, 999)).toBe(1234567890)
    })

    it('returns fallback for invalid string or null/undefined', () => {
      expect(getTimestamp('invalid-date', 999)).toBe(999)
      expect(getTimestamp(null, 999)).toBe(999)
      expect(getTimestamp(undefined, 999)).toBe(999)
      expect(getTimestamp(NaN, 999)).toBe(999)
    })
  })

  describe('getMediaTypeFromMastodonAttachment', () => {
    it('maps image to image/jpeg', () => {
      expect(getMediaTypeFromMastodonAttachment({ type: 'image' } as any)).toBe(
        'image/jpeg'
      )
    })

    it('maps gifv and video to video/mp4', () => {
      expect(getMediaTypeFromMastodonAttachment({ type: 'gifv' } as any)).toBe(
        'video/mp4'
      )
      expect(getMediaTypeFromMastodonAttachment({ type: 'video' } as any)).toBe(
        'video/mp4'
      )
    })

    it('maps audio to audio/mpeg', () => {
      expect(getMediaTypeFromMastodonAttachment({ type: 'audio' } as any)).toBe(
        'audio/mpeg'
      )
    })

    it('falls back to application/octet-stream', () => {
      expect(
        getMediaTypeFromMastodonAttachment({ type: 'unknown' } as any)
      ).toBe('application/octet-stream')
    })
  })

  describe('getMediaAttachmentDimensions', () => {
    it('prefers original dimensions in meta', () => {
      const dimensions = getMediaAttachmentDimensions(
        {
          meta: {
            original: { width: 1920, height: 1080 },
            width: 800,
            height: 600
          }
        } as any,
        { width: 400, height: 300 }
      )
      expect(dimensions).toEqual({ width: 1920, height: 1080 })
    })

    it('falls back to top-level meta dimensions', () => {
      const dimensions = getMediaAttachmentDimensions(
        {
          meta: { width: 800, height: 600 }
        } as any,
        { width: 400, height: 300 }
      )
      expect(dimensions).toEqual({ width: 800, height: 600 })
    })

    it('falls back to uploaded attachment fallback dimensions', () => {
      const dimensions = getMediaAttachmentDimensions({} as any, {
        width: 400,
        height: 300
      })
      expect(dimensions).toEqual({ width: 400, height: 300 })
    })
  })

  describe('getStatusAttachmentsFromUpdateResponse', () => {
    it('merges updated media attachments and preserves non-media attachments', () => {
      const existingAttachments: Attachment[] = [
        mediaAttachment1,
        fitnessAttachment,
        unsupportedAttachment
      ]

      const uploadedAttachments: PostBoxAttachment[] = [
        {
          type: 'upload',
          id: 'media-1-replacement',
          mediaType: 'image/jpeg',
          url: 'https://activities.local/files/replacement.jpg',
          width: 1200,
          height: 900,
          name: 'Updated Photo'
        }
      ]

      const responseMedia: UpdateNoteMediaAttachment[] = [
        {
          id: 'server-att-1',
          type: 'image',
          url: 'https://activities.local/files/replacement.jpg',
          preview_url: null,
          remote_url: null,
          description: 'Updated Photo Description',
          blurhash: null,
          meta: {
            original: {
              width: 1200,
              height: 900
            }
          }
        } as UpdateNoteMediaAttachment
      ]

      const result = getStatusAttachmentsFromUpdateResponse({
        actorId: 'actor-1',
        existingAttachments,
        mediaAttachments: responseMedia,
        statusId: 'status-updated',
        uploadedAttachments,
        updatedAt: 5000
      })

      // 1 updated media attachment + 2 preserved non-media attachments
      expect(result).toHaveLength(3)

      expect(result[0]).toEqual({
        id: 'server-att-1',
        actorId: 'actor-1',
        statusId: 'status-updated',
        type: 'Document',
        mediaType: 'image/jpeg',
        url: 'https://activities.local/files/replacement.jpg',
        width: 1200,
        height: 900,
        name: 'Updated Photo Description',
        mediaId: 'media-1-replacement',
        createdAt: 5000,
        updatedAt: 5000
      })

      // Preserved attachments updated statusId and updatedAt
      expect(result[1]).toEqual({
        ...fitnessAttachment,
        statusId: 'status-updated',
        updatedAt: 5000
      })

      expect(result[2]).toEqual({
        ...unsupportedAttachment,
        statusId: 'status-updated',
        updatedAt: 5000
      })
    })

    it('does not duplicate preserved attachments if already present in response mediaAttachments', () => {
      const existingAttachments: Attachment[] = [unsupportedAttachment]
      const responseMedia: UpdateNoteMediaAttachment[] = [
        {
          id: unsupportedAttachment.id,
          url: unsupportedAttachment.url,
          type: 'image'
        } as any
      ]

      const result = getStatusAttachmentsFromUpdateResponse({
        actorId: 'actor-1',
        existingAttachments,
        mediaAttachments: responseMedia,
        statusId: 'status-1',
        uploadedAttachments: [],
        updatedAt: 2000
      })

      expect(result).toHaveLength(1)
    })
  })
})
