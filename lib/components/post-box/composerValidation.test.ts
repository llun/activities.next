import { describe, expect, it } from 'vitest'

import { Attachment, PostBoxAttachment } from '@/lib/types/domain/attachment'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import {
  getEditableStatusText,
  hasEditPostContent,
  hasNewPostContent,
  isEditDirty,
  isEditSubmittable,
  isWithinLengthLimit
} from './composerValidation'

describe('composerValidation', () => {
  const sampleAttachment: PostBoxAttachment = {
    type: 'upload',
    id: 'media-1',
    mediaType: 'image/jpeg',
    url: 'https://activities.local/files/photo1.jpg',
    width: 800,
    height: 600,
    name: 'Photo 1'
  }

  const sampleDomainAttachment: Attachment = {
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

  const baseEditableStatus = {
    id: 'status-1',
    text: 'Original post message',
    summary: 'Content warning',
    attachments: [sampleDomainAttachment],
    createdAt: 1000,
    updatedAt: 1000,
    reply: '',
    type: StatusType.enum.Note
  } as unknown as EditableStatus

  describe('isWithinLengthLimit', () => {
    it('returns true when content length is within or equal to limit', () => {
      expect(isWithinLengthLimit('hello', 10)).toBe(true)
      expect(isWithinLengthLimit('hello', 5)).toBe(true)
    })

    it('returns false when content length exceeds limit', () => {
      expect(isWithinLengthLimit('hello!', 5)).toBe(false)
      expect(isWithinLengthLimit('a'.repeat(501), 500)).toBe(false)
    })
  })

  describe('hasNewPostContent', () => {
    it('returns false for blank or whitespace-only content without attachments', () => {
      expect(hasNewPostContent('', { attachments: [] }, 500)).toBe(false)
      expect(hasNewPostContent('   \n\t  ', { attachments: [] }, 500)).toBe(
        false
      )
    })

    it('returns true for non-empty text within limit', () => {
      expect(hasNewPostContent('Hello world', { attachments: [] }, 500)).toBe(
        true
      )
    })

    it('returns false when text exceeds character limit', () => {
      const overLimitText = 'a'.repeat(501)
      expect(hasNewPostContent(overLimitText, { attachments: [] }, 500)).toBe(
        false
      )
    })

    it('returns true for blank text when media attachments are present', () => {
      expect(
        hasNewPostContent('', { attachments: [sampleAttachment] }, 500)
      ).toBe(true)
      expect(
        hasNewPostContent('   ', { attachments: [sampleAttachment] }, 500)
      ).toBe(true)
    })

    it('returns true for blank text when a fitness file is attached', () => {
      expect(
        hasNewPostContent('', { attachments: [], fitnessFile: {} }, 500)
      ).toBe(true)
    })

    it('returns false when media is attached but text exceeds limit', () => {
      const overLimitText = 'a'.repeat(501)
      expect(
        hasNewPostContent(
          overLimitText,
          { attachments: [sampleAttachment] },
          500
        )
      ).toBe(false)
    })
  })

  describe('hasEditPostContent', () => {
    it('returns false when text is blank and no attachments or preserved attachments exist', () => {
      const emptyStatus: EditableStatus = {
        ...baseEditableStatus,
        attachments: []
      }
      expect(
        hasEditPostContent(emptyStatus, '', { attachments: [] }, 500)
      ).toBe(false)
      expect(
        hasEditPostContent(emptyStatus, '   ', { attachments: [] }, 500)
      ).toBe(false)
    })

    it('returns true when text is within limit', () => {
      expect(
        hasEditPostContent(
          baseEditableStatus,
          'Updated text',
          { attachments: [] },
          500
        )
      ).toBe(true)
    })

    it('returns false when text exceeds character limit', () => {
      expect(
        hasEditPostContent(
          baseEditableStatus,
          'a'.repeat(501),
          { attachments: [sampleAttachment] },
          500
        )
      ).toBe(false)
    })

    it('returns true for blank text if new attachments are present', () => {
      const emptyStatus: EditableStatus = {
        ...baseEditableStatus,
        attachments: []
      }
      expect(
        hasEditPostContent(
          emptyStatus,
          '',
          { attachments: [sampleAttachment] },
          500
        )
      ).toBe(true)
    })

    it('returns true for blank text if status has preserved attachments', () => {
      const preservedAttachment: Attachment = {
        id: 'att-preserved',
        actorId: 'actor-1',
        statusId: 'status-1',
        type: 'Document',
        mediaType: 'application/vnd.antigravity.fitness+json',
        url: 'https://activities.local/run.fit',
        name: 'Run',
        createdAt: 1000,
        updatedAt: 1000
      }
      const statusWithPreserved: EditableStatus = {
        ...baseEditableStatus,
        attachments: [preservedAttachment]
      }
      expect(
        hasEditPostContent(statusWithPreserved, '', { attachments: [] }, 500)
      ).toBe(true)
    })
  })

  describe('getEditableStatusText', () => {
    it('extracts status text', () => {
      expect(getEditableStatusText(baseEditableStatus)).toBe(
        'Original post message'
      )
    })
  })

  describe('isEditDirty', () => {
    it('returns false when editStatus is undefined or null', () => {
      expect(
        isEditDirty({
          editStatus: null,
          value: 'Hello',
          attachments: []
        })
      ).toBe(false)
    })

    it('returns false when text, content warning, and attachments match baseline', () => {
      expect(
        isEditDirty({
          editStatus: baseEditableStatus,
          value: baseEditableStatus.text,
          contentWarning: baseEditableStatus.summary!,
          contentWarningVisible: true,
          attachments: [sampleAttachment]
        })
      ).toBe(false)
    })

    it('returns true when text is modified', () => {
      expect(
        isEditDirty({
          editStatus: baseEditableStatus,
          value: 'Modified message',
          contentWarning: baseEditableStatus.summary!,
          contentWarningVisible: true,
          attachments: [sampleAttachment]
        })
      ).toBe(true)
    })

    it('returns true when content warning text is modified', () => {
      expect(
        isEditDirty({
          editStatus: baseEditableStatus,
          value: baseEditableStatus.text,
          contentWarning: 'Different warning',
          contentWarningVisible: true,
          attachments: [sampleAttachment]
        })
      ).toBe(true)
    })

    it('returns true when content warning is toggled hidden when baseline had one', () => {
      expect(
        isEditDirty({
          editStatus: baseEditableStatus,
          value: baseEditableStatus.text,
          contentWarning: baseEditableStatus.summary!,
          contentWarningVisible: false,
          attachments: [sampleAttachment]
        })
      ).toBe(true)
    })

    it('returns false when content warning is hidden and baseline had no summary', () => {
      const statusNoSummary: EditableStatus = {
        ...baseEditableStatus,
        summary: null
      }
      expect(
        isEditDirty({
          editStatus: statusNoSummary,
          value: statusNoSummary.text,
          contentWarning: 'draft warning',
          contentWarningVisible: false,
          attachments: [sampleAttachment]
        })
      ).toBe(false)
    })

    it('returns true when an attachment is removed', () => {
      expect(
        isEditDirty({
          editStatus: baseEditableStatus,
          value: baseEditableStatus.text,
          contentWarning: baseEditableStatus.summary!,
          contentWarningVisible: true,
          attachments: []
        })
      ).toBe(true)
    })

    it('returns true when an attachment is added', () => {
      const extraAttachment: PostBoxAttachment = {
        ...sampleAttachment,
        id: 'media-2'
      }
      expect(
        isEditDirty({
          editStatus: baseEditableStatus,
          value: baseEditableStatus.text,
          contentWarning: baseEditableStatus.summary!,
          contentWarningVisible: true,
          attachments: [sampleAttachment, extraAttachment]
        })
      ).toBe(true)
    })

    it('returns true when attachments are reordered', () => {
      const att1: Attachment = {
        ...sampleDomainAttachment,
        mediaId: 'm1',
        id: '1'
      }
      const att2: Attachment = {
        ...sampleDomainAttachment,
        mediaId: 'm2',
        id: '2'
      }
      const statusWithTwo: EditableStatus = {
        ...baseEditableStatus,
        attachments: [att1, att2]
      }

      const reorderedDraft: PostBoxAttachment[] = [
        { ...sampleAttachment, id: 'm2' },
        { ...sampleAttachment, id: 'm1' }
      ]

      expect(
        isEditDirty({
          editStatus: statusWithTwo,
          value: statusWithTwo.text,
          contentWarning: statusWithTwo.summary!,
          contentWarningVisible: true,
          attachments: reorderedDraft
        })
      ).toBe(true)
    })
  })

  describe('isEditSubmittable', () => {
    it('returns false when edit is not dirty', () => {
      expect(
        isEditSubmittable({
          editStatus: baseEditableStatus,
          value: baseEditableStatus.text,
          contentWarning: baseEditableStatus.summary!,
          contentWarningVisible: true,
          attachments: [sampleAttachment],
          maxLength: 500
        })
      ).toBe(false)
    })

    it('returns true when edit is dirty and has valid content within limit', () => {
      expect(
        isEditSubmittable({
          editStatus: baseEditableStatus,
          value: 'Changed text',
          contentWarning: baseEditableStatus.summary!,
          contentWarningVisible: true,
          attachments: [sampleAttachment],
          maxLength: 500
        })
      ).toBe(true)
    })

    it('returns false when edit is dirty but exceeds character limit', () => {
      expect(
        isEditSubmittable({
          editStatus: baseEditableStatus,
          value: 'a'.repeat(501),
          contentWarning: baseEditableStatus.summary!,
          contentWarningVisible: true,
          attachments: [sampleAttachment],
          maxLength: 500
        })
      ).toBe(false)
    })

    it('returns false when edit is dirty but has empty content and no attachments', () => {
      const emptyStatus: EditableStatus = {
        ...baseEditableStatus,
        attachments: []
      }
      expect(
        isEditSubmittable({
          editStatus: emptyStatus,
          value: '',
          contentWarning: '',
          contentWarningVisible: false,
          attachments: [],
          maxLength: 500
        })
      ).toBe(false)
    })
  })
})
