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

    it.each([
      ['identical order', [itemA, itemB], [itemA, itemB], true],
      ['same IDs in different order', [itemA, itemB], [itemB, itemA], false],
      ['the first list is shorter', [itemA], [itemA, itemB], false],
      ['the second list is shorter', [itemA, itemB], [itemA], false],
      ['different IDs', [itemA, itemB], [itemA, itemC], false],
      ['two empty lists', [], [], true]
    ])(
      'compares attachment IDs in order: %s',
      (_case, left, right, expected) => {
        expect(areAttachmentIdsEqualInOrder(left, right)).toBe(expected)
      }
    )
  })

  describe('getTimestamp', () => {
    it.each([
      ['a finite number', 12345, 12345],
      [
        'a valid ISO string',
        '2026-09-07T12:00:00Z',
        Date.parse('2026-09-07T12:00:00Z')
      ],
      ['a Date object', new Date(1234567890), 1234567890],
      ['an invalid string', 'invalid-date', 999],
      ['null', null, 999],
      ['undefined', undefined, 999],
      ['NaN', NaN, 999]
    ])('reads %s (fallback 999)', (_case, input, expected) => {
      expect(getTimestamp(input, 999)).toBe(expected)
    })
  })

  describe('getMediaTypeFromMastodonAttachment', () => {
    it.each([
      ['image', 'image/jpeg'],
      ['gifv', 'video/mp4'],
      ['video', 'video/mp4'],
      ['audio', 'audio/mpeg'],
      ['unknown', 'application/octet-stream']
    ])('maps %s to %s', (type, expected) => {
      expect(getMediaTypeFromMastodonAttachment({ type } as any)).toBe(expected)
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
