import { resolveStatusAttachmentMediaIds } from '@/lib/services/statuses/mediaIds'
import { Status } from '@/lib/types/domain/status'

const statusWithAttachments = (
  attachments: { id: string; mediaId: string | null }[]
) =>
  ({
    type: 'Note',
    attachments: attachments.map(({ id, mediaId }) => ({
      id,
      actorId: 'https://llun.test/users/test1',
      statusId: 'https://llun.test/users/test1/statuses/1',
      type: 'Document',
      mediaType: 'image/png',
      url: 'https://llun.test/api/v1/files/medias/one.png',
      name: '',
      mediaId,
      createdAt: 0,
      updatedAt: 0
    }))
  }) as unknown as Status

describe('resolveStatusAttachmentMediaIds', () => {
  it('resolves the attachment id the status entity publishes to its media row id', () => {
    const status = statusWithAttachments([
      { id: 'attachment-uuid-1', mediaId: '12' },
      { id: 'attachment-uuid-2', mediaId: '34' }
    ])

    expect(
      resolveStatusAttachmentMediaIds(status, [
        'attachment-uuid-2',
        'attachment-uuid-1'
      ])
    ).toEqual(['34', '12'])
  })

  it.each([
    ['a media row id, which needs no resolution', ['12'], ['12']],
    ['an id belonging to no attachment on this status', ['99'], ['99']],
    [
      'an attachment with no media row behind it',
      ['attachment-uuid-3'],
      ['attachment-uuid-3']
    ]
  ])('passes through %s', (_description, input, expected) => {
    const status = statusWithAttachments([
      { id: 'attachment-uuid-1', mediaId: '12' },
      { id: 'attachment-uuid-3', mediaId: null }
    ])

    expect(resolveStatusAttachmentMediaIds(status, input)).toEqual(expected)
  })

  it('answers the ids unchanged for a status carrying no attachments', () => {
    expect(
      resolveStatusAttachmentMediaIds(statusWithAttachments([]), ['12'])
    ).toEqual(['12'])
  })
})
