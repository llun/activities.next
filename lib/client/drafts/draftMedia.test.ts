import { deleteAccountMedia } from '@/lib/client/accounts'
import { deleteFitnessFile } from '@/lib/client/fitnessRoutes'
import { deleteUnpostedMedia } from '@/lib/client/media'

import {
  blobRecordToFile,
  blobRecordToPosterFile,
  deleteDraftAndOwnedMedia,
  fileToBlobRecord
} from './draftMedia'
import { deleteDraft } from './draftsDb'
import type { DraftAttachment, DraftRecord } from './types'

vi.mock('@/lib/client/media', () => ({ deleteUnpostedMedia: vi.fn() }))
vi.mock('@/lib/client/accounts', () => ({ deleteAccountMedia: vi.fn() }))
vi.mock('@/lib/client/fitnessRoutes', () => ({ deleteFitnessFile: vi.fn() }))
vi.mock('./draftsDb', () => ({ deleteDraft: vi.fn() }))

const attachment = (patch: Partial<DraftAttachment>): DraftAttachment => ({
  localId: 'l',
  owned: true,
  mediaType: 'image/png',
  fileName: 'a.png',
  description: '',
  decorative: false,
  hasBlob: true,
  ...patch
})

const draft = (patch: Partial<DraftRecord> = {}): DraftRecord => ({
  id: 'd1',
  accountId: 'account-1',
  actorId: 'actor-1',
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  composer: 'post-box',
  text: '',
  contentWarning: '',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: [],
  ...patch
})

const fitness = (patch = {}) => ({
  localId: 'f',
  fileName: 'run.fit',
  mimeType: 'application/octet-stream',
  size: 10,
  fitnessFileId: 'fit-1',
  owned: true,
  hasBlob: true,
  ...patch
})

describe('deleteDraftAndOwnedMedia', () => {
  beforeEach(() => {
    vi.mocked(deleteDraft).mockReset().mockResolvedValue(undefined)
    vi.mocked(deleteUnpostedMedia).mockReset().mockResolvedValue(undefined)
    vi.mocked(deleteFitnessFile).mockReset().mockResolvedValue(undefined)
  })

  it('deletes the draft record before any media', async () => {
    const order: string[] = []
    vi.mocked(deleteDraft).mockImplementation(async () => {
      order.push('draft')
    })
    vi.mocked(deleteUnpostedMedia).mockImplementation(async () => {
      order.push('media')
    })

    await deleteDraftAndOwnedMedia(
      draft({ attachments: [attachment({ mediaId: 'm1' })] })
    )

    expect(deleteDraft).toHaveBeenCalledWith('d1')
    expect(order).toEqual(['draft', 'media'])
  })

  it('deletes only owned, uploaded media, and never calls deleteAccountMedia', async () => {
    await deleteDraftAndOwnedMedia(
      draft({
        attachments: [
          attachment({ localId: '1', mediaId: 'owned' }),
          attachment({ localId: '2', mediaId: 'borrowed', owned: false }),
          attachment({ localId: '3', owned: true }) // not uploaded yet
        ]
      })
    )

    expect(deleteUnpostedMedia).toHaveBeenCalledExactlyOnceWith('owned')
    expect(deleteAccountMedia).not.toHaveBeenCalled()
  })

  it('swallows a failure such as a 422 for media a post uses', async () => {
    vi.mocked(deleteUnpostedMedia).mockRejectedValue(
      new Error('This photo is in a post, so it can’t be deleted.')
    )

    await expect(
      deleteDraftAndOwnedMedia(
        draft({ attachments: [attachment({ mediaId: 'm1' })] })
      )
    ).resolves.toBeUndefined()
  })

  it('deletes the fitness file only when owned and never attempted', async () => {
    await deleteDraftAndOwnedMedia(draft({ fitnessFile: fitness() }))
    expect(deleteFitnessFile).toHaveBeenCalledExactlyOnceWith('fit-1')

    vi.mocked(deleteFitnessFile).mockClear()
    await deleteDraftAndOwnedMedia(
      draft({ fitnessFile: fitness(), attemptedAt: 5 })
    )
    await deleteDraftAndOwnedMedia(
      draft({ fitnessFile: fitness({ owned: false }) })
    )
    await deleteDraftAndOwnedMedia(
      draft({ fitnessFile: fitness({ fitnessFileId: undefined }) })
    )
    expect(deleteFitnessFile).not.toHaveBeenCalled()
  })

  it('deletes nothing for a locked draft, whose media is no longer owned', async () => {
    await deleteDraftAndOwnedMedia(
      draft({
        lockedMessage: 'Saved on the server',
        attemptedAt: 5,
        attachments: [attachment({ mediaId: 'm1', owned: false })],
        fitnessFile: fitness({ owned: false })
      })
    )

    expect(deleteDraft).toHaveBeenCalledOnce()
    expect(deleteUnpostedMedia).not.toHaveBeenCalled()
    expect(deleteFitnessFile).not.toHaveBeenCalled()
  })

  it('does not touch media when deleting the record fails', async () => {
    vi.mocked(deleteDraft).mockRejectedValue(new Error('unavailable'))

    await expect(
      deleteDraftAndOwnedMedia(
        draft({ attachments: [attachment({ mediaId: 'm1' })] })
      )
    ).rejects.toThrow('unavailable')
    expect(deleteUnpostedMedia).not.toHaveBeenCalled()
  })
})

describe('blob records', () => {
  it('round-trips a File through ArrayBuffer + MIME + name + lastModified', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', {
      type: 'image/png',
      lastModified: 1234
    })
    const poster = new File([new Uint8Array([9])], 'poster.jpg', {
      type: 'image/jpeg'
    })

    const record = await fileToBlobRecord({
      id: 'l1',
      draftId: 'd1',
      file,
      poster
    })

    expect(record.bytes).toBeInstanceOf(ArrayBuffer)
    expect(record).toMatchObject({
      id: 'l1',
      draftId: 'd1',
      mimeType: 'image/png',
      fileName: 'photo.png',
      lastModified: 1234
    })
    const rebuilt = blobRecordToFile({ ...record, accountId: 'account-1' })
    expect(rebuilt).toMatchObject({
      name: 'photo.png',
      type: 'image/png',
      lastModified: 1234
    })
    expect(Array.from(new Uint8Array(await rebuilt.arrayBuffer()))).toEqual([
      1, 2, 3
    ])
    const rebuiltPoster = blobRecordToPosterFile({
      ...record,
      accountId: 'account-1'
    })
    expect(rebuiltPoster).toMatchObject({
      name: 'poster.jpg',
      type: 'image/jpeg'
    })
  })

  it('has no poster when none was given', async () => {
    const record = await fileToBlobRecord({
      id: 'l1',
      draftId: 'd1',
      file: new File(['x'], 'a.txt', { type: 'text/plain' })
    })

    expect(
      blobRecordToPosterFile({ ...record, accountId: 'account-1' })
    ).toBeUndefined()
  })
})
