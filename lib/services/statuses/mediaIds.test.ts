import { Database } from '@/lib/database/types'
import {
  getAttachmentsFromMediaIds,
  resolveStatusAttachmentMediaIds
} from '@/lib/services/statuses/mediaIds'
import { Actor } from '@/lib/types/domain/actor'
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

describe('getAttachmentsFromMediaIds', () => {
  it('uses media description when present and does not fall back to fileName when description is empty', async () => {
    const mockDatabase = {
      getMediaByIdForAccount: vi.fn().mockImplementation(({ mediaId }) => {
        if (mediaId === '1') {
          return Promise.resolve({
            id: '1',
            original: {
              path: 'medias/with-desc.png',
              mimeType: 'image/png',
              metaData: { width: 100, height: 100 },
              fileName: 'with-desc.png'
            },
            description: 'Custom alt text'
          })
        }
        return Promise.resolve({
          id: '2',
          original: {
            path: 'medias/without-desc.png',
            mimeType: 'image/png',
            metaData: { width: 100, height: 100 },
            fileName: 'without-desc.png'
          },
          description: null
        })
      })
    } as unknown as Database

    const currentActor = {
      id: 'https://llun.test/users/test1',
      account: { id: 'account-1' }
    } as unknown as Actor

    const attachments = await getAttachmentsFromMediaIds(
      mockDatabase,
      currentActor,
      ['1', '2']
    )
    expect(attachments).toEqual([
      expect.objectContaining({
        id: '1',
        name: 'Custom alt text'
      }),
      expect.objectContaining({
        id: '2'
      })
    ])
    expect(attachments?.[1].name).toBeUndefined()
  })
})
