import type { BaseNote } from '@/lib/activities/note'
import type { Database } from '@/lib/database/types'
import { createRemoteAttachments } from '@/lib/jobs/noteAttachments'

const STATUS_ID = 'https://remote.test/users/alice/statuses/1'

const noteWith = (attachments: unknown[]): BaseNote =>
  ({
    type: 'Note',
    id: STATUS_ID,
    attributedTo: 'https://remote.test/users/alice',
    published: '2026-01-01T00:00:00.000Z',
    attachment: attachments
  }) as unknown as BaseNote

const imageAttachment = (name: string) => ({
  type: 'Document',
  mediaType: 'image/jpeg',
  url: `https://remote.test/media/${name}.jpg`,
  name
})

describe('createRemoteAttachments', () => {
  it('indexes the status once, after every attachment is stored', async () => {
    const calls: string[] = []
    const database = {
      createAttachment: vi.fn(async () => {
        calls.push('createAttachment')
        return {}
      }),
      indexStatusSearchDocument: vi.fn(async () => {
        calls.push('indexStatusSearchDocument')
      })
    } as unknown as Database

    await createRemoteAttachments({
      database,
      statusId: STATUS_ID,
      note: noteWith([imageAttachment('first'), imageAttachment('second')])
    })

    expect(database.createAttachment).toHaveBeenCalledTimes(2)
    expect(database.indexStatusSearchDocument).toHaveBeenCalledTimes(1)
    expect(database.indexStatusSearchDocument).toHaveBeenCalledWith({
      statusId: STATUS_ID
    })
    expect(calls).toEqual([
      'createAttachment',
      'createAttachment',
      'indexStatusSearchDocument'
    ])
  })

  it('does not index a note with no attachments', async () => {
    const database = {
      createAttachment: vi.fn(),
      indexStatusSearchDocument: vi.fn()
    } as unknown as Database

    await createRemoteAttachments({
      database,
      statusId: STATUS_ID,
      note: noteWith([])
    })

    expect(database.createAttachment).not.toHaveBeenCalled()
    expect(database.indexStatusSearchDocument).not.toHaveBeenCalled()
  })

  it('keeps the stored attachments when indexing fails', async () => {
    const database = {
      createAttachment: vi.fn(async () => ({})),
      indexStatusSearchDocument: vi
        .fn()
        .mockRejectedValue(new Error('index unavailable'))
    } as unknown as Database

    await expect(
      createRemoteAttachments({
        database,
        statusId: STATUS_ID,
        note: noteWith([imageAttachment('first')])
      })
    ).resolves.toBeUndefined()
    expect(database.createAttachment).toHaveBeenCalledTimes(1)
  })
})
