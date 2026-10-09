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
    const overLimitText = 'a'.repeat(501)

    it.each([
      ['empty text, no attachments', '', { attachments: [] }, false],
      [
        'whitespace-only text, no attachments',
        '   \n\t  ',
        { attachments: [] },
        false
      ],
      ['non-empty text within limit', 'Hello world', { attachments: [] }, true],
      ['text over the limit', overLimitText, { attachments: [] }, false],
      [
        'empty text with a media attachment',
        '',
        { attachments: [sampleAttachment] },
        true
      ],
      [
        'whitespace text with a media attachment',
        '   ',
        { attachments: [sampleAttachment] },
        true
      ],
      [
        'empty text with a fitness file',
        '',
        { attachments: [], fitnessFile: {} },
        true
      ],
      [
        'media attached but text over the limit',
        overLimitText,
        { attachments: [sampleAttachment] },
        false
      ]
    ])('%s -> %s', (_case, text, attachments, expected) => {
      expect(hasNewPostContent(text, attachments, 500)).toBe(expected)
    })
  })

  describe('hasEditPostContent', () => {
    const emptyStatus: EditableStatus = {
      ...baseEditableStatus,
      attachments: []
    }
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

    it.each([
      ['blank text, nothing attached', emptyStatus, '', [], false],
      ['whitespace text, nothing attached', emptyStatus, '   ', [], false],
      ['text within limit', baseEditableStatus, 'Updated text', [], true],
      [
        'text over the limit',
        baseEditableStatus,
        'a'.repeat(501),
        [sampleAttachment],
        false
      ],
      [
        'blank text with a new attachment',
        emptyStatus,
        '',
        [sampleAttachment],
        true
      ],
      [
        'blank text with a preserved attachment on the status',
        statusWithPreserved,
        '',
        [],
        true
      ]
    ])('%s -> %s', (_case, status, text, attachments, expected) => {
      expect(hasEditPostContent(status, text, { attachments }, 500)).toBe(
        expected
      )
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
    const baseline = {
      editStatus: baseEditableStatus as EditableStatus | null,
      value: baseEditableStatus.text,
      contentWarning: baseEditableStatus.summary!,
      contentWarningVisible: true,
      attachments: [sampleAttachment]
    }
    const extraAttachment: PostBoxAttachment = {
      ...sampleAttachment,
      id: 'media-2'
    }
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
    const statusNoSummary: EditableStatus = {
      ...baseEditableStatus,
      summary: null
    }

    it.each([
      [
        'there is no status being edited',
        { editStatus: null, value: 'Hello', attachments: [] },
        false
      ],
      ['text, warning and attachments match the baseline', {}, false],
      ['text is modified', { value: 'Modified message' }, true],
      [
        'content warning text is modified',
        { contentWarning: 'Different warning' },
        true
      ],
      [
        'content warning is hidden but the baseline had one',
        { contentWarningVisible: false },
        true
      ],
      [
        'content warning is hidden and the baseline had no summary',
        {
          editStatus: statusNoSummary,
          value: statusNoSummary.text,
          contentWarning: 'draft warning',
          contentWarningVisible: false
        },
        false
      ],
      ['an attachment is removed', { attachments: [] }, true],
      [
        'an attachment is added',
        { attachments: [sampleAttachment, extraAttachment] },
        true
      ],
      [
        'attachments are reordered',
        {
          editStatus: statusWithTwo,
          value: statusWithTwo.text,
          contentWarning: statusWithTwo.summary!,
          attachments: [
            { ...sampleAttachment, id: 'm2' },
            { ...sampleAttachment, id: 'm1' }
          ]
        },
        true
      ]
    ])('is dirty when %s -> %s', (_case, overrides, expected) => {
      expect(isEditDirty({ ...baseline, ...overrides })).toBe(expected)
    })
  })

  describe('isEditSubmittable', () => {
    const baseline = {
      editStatus: baseEditableStatus as EditableStatus | null,
      value: baseEditableStatus.text,
      contentWarning: baseEditableStatus.summary!,
      contentWarningVisible: true,
      attachments: [sampleAttachment],
      maxLength: 500
    }

    it.each([
      ['the edit is not dirty', {}, false],
      [
        'the edit is dirty with valid content within the limit',
        { value: 'Changed text' },
        true
      ],
      [
        'the edit is dirty but exceeds the character limit',
        { value: 'a'.repeat(501) },
        false
      ],
      [
        'the edit is dirty but has empty content and no attachments',
        {
          editStatus: { ...baseEditableStatus, attachments: [] },
          value: '',
          contentWarning: '',
          contentWarningVisible: false,
          attachments: []
        },
        false
      ]
    ])('submittable when %s -> %s', (_case, overrides, expected) => {
      expect(isEditSubmittable({ ...baseline, ...overrides })).toBe(expected)
    })
  })
})
