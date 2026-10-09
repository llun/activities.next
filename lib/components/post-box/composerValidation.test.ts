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
      {
        case: 'empty text, no attachments',
        text: '',
        att: { attachments: [] },
        expected: false
      },
      {
        case: 'whitespace-only text, no attachments',
        text: '   \n\t  ',
        att: { attachments: [] },
        expected: false
      },
      {
        case: 'non-empty text within limit',
        text: 'Hello world',
        att: { attachments: [] },
        expected: true
      },
      {
        case: 'text over the limit',
        text: overLimitText,
        att: { attachments: [] },
        expected: false
      },
      {
        case: 'empty text with a media attachment',
        text: '',
        att: { attachments: [sampleAttachment] },
        expected: true
      },
      {
        case: 'whitespace text with a media attachment',
        text: '   ',
        att: { attachments: [sampleAttachment] },
        expected: true
      },
      {
        case: 'empty text with a fitness file',
        text: '',
        att: { attachments: [], fitnessFile: {} },
        expected: true
      },
      {
        case: 'media attached but text over the limit',
        text: overLimitText,
        att: { attachments: [sampleAttachment] },
        expected: false
      }
    ])(
      'hasNewPostContent for $case is $expected',
      ({ text, att, expected }) => {
        expect(hasNewPostContent(text, att, 500)).toBe(expected)
      }
    )
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
      {
        case: 'blank text, nothing attached',
        status: emptyStatus,
        text: '',
        attachments: [],
        expected: false
      },
      {
        case: 'whitespace text, nothing attached',
        status: emptyStatus,
        text: '   ',
        attachments: [],
        expected: false
      },
      {
        case: 'text within limit',
        status: baseEditableStatus,
        text: 'Updated text',
        attachments: [],
        expected: true
      },
      {
        case: 'text over the limit',
        status: baseEditableStatus,
        text: 'a'.repeat(501),
        attachments: [sampleAttachment],
        expected: false
      },
      {
        case: 'blank text with a new attachment',
        status: emptyStatus,
        text: '',
        attachments: [sampleAttachment],
        expected: true
      },
      {
        case: 'blank text with a preserved attachment on the status',
        status: statusWithPreserved,
        text: '',
        attachments: [],
        expected: true
      }
    ])(
      'hasEditPostContent for $case is $expected',
      ({ status, text, attachments, expected }) => {
        expect(hasEditPostContent(status, text, { attachments }, 500)).toBe(
          expected
        )
      }
    )
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
      {
        case: 'there is no status being edited',
        overrides: { editStatus: null, value: 'Hello', attachments: [] },
        expected: false
      },
      {
        case: 'text, warning and attachments match the baseline',
        overrides: {},
        expected: false
      },
      {
        case: 'text is modified',
        overrides: { value: 'Modified message' },
        expected: true
      },
      {
        case: 'content warning text is modified',
        overrides: { contentWarning: 'Different warning' },
        expected: true
      },
      {
        case: 'content warning is hidden but the baseline had one',
        overrides: { contentWarningVisible: false },
        expected: true
      },
      {
        case: 'content warning is hidden and the baseline had no summary',
        overrides: {
          editStatus: statusNoSummary,
          value: statusNoSummary.text,
          contentWarning: 'draft warning',
          contentWarningVisible: false
        },
        expected: false
      },
      {
        case: 'an attachment is removed',
        overrides: { attachments: [] },
        expected: true
      },
      {
        case: 'an attachment is added',
        overrides: { attachments: [sampleAttachment, extraAttachment] },
        expected: true
      },
      {
        case: 'attachments are reordered',
        overrides: {
          editStatus: statusWithTwo,
          value: statusWithTwo.text,
          contentWarning: statusWithTwo.summary!,
          attachments: [
            { ...sampleAttachment, id: 'm2' },
            { ...sampleAttachment, id: 'm1' }
          ]
        },
        expected: true
      }
    ])('isEditDirty when $case is $expected', ({ overrides, expected }) => {
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
      {
        case: 'the edit is not dirty',
        overrides: {},
        expected: false
      },
      {
        case: 'the edit is dirty with valid content within the limit',
        overrides: { value: 'Changed text' },
        expected: true
      },
      {
        case: 'the edit is dirty but exceeds the character limit',
        overrides: { value: 'a'.repeat(501) },
        expected: false
      },
      {
        case: 'the edit is dirty but has empty content and no attachments',
        overrides: {
          editStatus: { ...baseEditableStatus, attachments: [] },
          value: '',
          contentWarning: '',
          contentWarningVisible: false,
          attachments: []
        },
        expected: false
      }
    ])(
      'isEditSubmittable when $case is $expected',
      ({ overrides, expected }) => {
        expect(isEditSubmittable({ ...baseline, ...overrides })).toBe(expected)
      }
    )
  })
})
