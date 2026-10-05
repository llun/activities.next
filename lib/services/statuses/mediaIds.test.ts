import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import {
  getAttachmentsFromMediaIds,
  resolveStatusAttachmentMediaIds
} from '@/lib/services/statuses/mediaIds'
import { TEST_DOMAIN } from '@/lib/stub/const'
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
            actorId: 'https://llun.test/users/test1',
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
          actorId: 'https://llun.test/users/test1',
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

  it('rejects media uploaded by a sibling actor of the same account', async () => {
    const database = getTestSQLDatabase()
    await database.migrate()
    try {
      await database.createAccount({
        email: `owner@${TEST_DOMAIN}`,
        username: 'owner',
        passwordHash: 'hash',
        domain: TEST_DOMAIN,
        privateKey: 'privateKey-owner',
        publicKey: 'publicKey-owner'
      })
      const owner = await database.getActorFromUsername({
        username: 'owner',
        domain: TEST_DOMAIN
      })
      if (!owner?.account) throw new Error('owner not created')
      const siblingId = await database.createActorForAccount({
        accountId: owner.account.id,
        username: 'sibling',
        domain: TEST_DOMAIN,
        privateKey: 'privateKey-sibling',
        publicKey: 'publicKey-sibling'
      })
      const media = (n: string, actorId: string) =>
        database.createMedia({
          actorId,
          original: {
            path: `medias/${n}.png`,
            bytes: 10,
            mimeType: 'image/png',
            metaData: { width: 1, height: 1 }
          }
        })
      const ownMedia = await media('own', owner.id)
      const siblingMedia = await media('sibling', siblingId)
      if (!ownMedia || !siblingMedia) throw new Error('media not created')

      // An OAuth token for `owner` must not attach the sibling's upload,
      // although both actors share an account.
      expect(
        await getAttachmentsFromMediaIds(database, owner, [siblingMedia.id])
      ).toBeNull()
      expect(
        await getAttachmentsFromMediaIds(database, owner, [
          ownMedia.id,
          siblingMedia.id
        ])
      ).toBeNull()
      expect(
        await getAttachmentsFromMediaIds(database, owner, [ownMedia.id])
      ).toEqual([expect.objectContaining({ id: ownMedia.id })])
    } finally {
      await database.destroy()
    }
  })
})
