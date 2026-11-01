/** @vitest-size medium */
import { IDBFactory } from 'fake-indexeddb'

import { deleteAccountMedia } from '@/lib/client/accounts'
import {
  deleteFitnessFile,
  deleteUnpostedFitnessFile
} from '@/lib/client/fitnessRoutes'
import { deleteUnpostedMedia } from '@/lib/client/media'

import {
  blobRecordToFile,
  blobRecordToPosterFile,
  deleteDraftAndOwnedMedia,
  fileToBlobRecord
} from './draftMedia'
import {
  DraftConflictError,
  DraftsUnavailableError,
  deleteDraft,
  getDraft,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from './draftsDb'
import type { DraftAttachment, DraftRecord } from './types'

vi.mock('@/lib/client/media', () => ({ deleteUnpostedMedia: vi.fn() }))
vi.mock('@/lib/client/accounts', () => ({ deleteAccountMedia: vi.fn() }))
vi.mock('@/lib/client/fitnessRoutes', () => ({
  deleteFitnessFile: vi.fn(),
  deleteUnpostedFitnessFile: vi.fn()
}))

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

// Real IndexedDB: the deletion must read and delete the stored row atomically.
const store = (patch: Partial<DraftRecord> = {}): Promise<DraftRecord> =>
  saveDraft(draft(patch), { expectedRevision: 0, epoch: 0 })

describe('deleteDraftAndOwnedMedia', () => {
  beforeEach(() => {
    setDraftsIndexedDBFactory(new IDBFactory())
    vi.mocked(deleteUnpostedMedia).mockReset().mockResolvedValue(undefined)
    vi.mocked(deleteFitnessFile).mockReset()
    vi.mocked(deleteUnpostedFitnessFile).mockReset().mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
  })

  it('deletes the draft record before any media', async () => {
    const saved = await store({ attachments: [attachment({ mediaId: 'm1' })] })
    vi.mocked(deleteUnpostedMedia).mockImplementation(async () => {
      // The record is already gone when media deletion starts.
      expect(await getDraft('d1')).toBeUndefined()
    })

    await deleteDraftAndOwnedMedia(saved)

    expect(deleteUnpostedMedia).toHaveBeenCalledExactlyOnceWith('m1')
  })

  it('deletes only owned, uploaded media, and never calls deleteAccountMedia', async () => {
    const saved = await store({
      attachments: [
        attachment({ localId: '1', mediaId: 'owned' }),
        attachment({ localId: '2', mediaId: 'borrowed', owned: false }),
        attachment({ localId: '3', owned: true }) // not uploaded yet
      ]
    })

    await deleteDraftAndOwnedMedia(saved)

    expect(deleteUnpostedMedia).toHaveBeenCalledExactlyOnceWith('owned')
    expect(deleteAccountMedia).not.toHaveBeenCalled()
  })

  it('swallows a failure such as a 422 for media a post uses', async () => {
    vi.mocked(deleteUnpostedMedia).mockRejectedValue(
      new Error('This photo is in a post, so it can’t be deleted.')
    )
    const saved = await store({ attachments: [attachment({ mediaId: 'm1' })] })

    await expect(deleteDraftAndOwnedMedia(saved)).resolves.toBeUndefined()
  })

  it('deletes the fitness file only when owned and never attempted', async () => {
    await deleteDraftAndOwnedMedia(await store({ fitnessFile: fitness() }))
    expect(deleteUnpostedFitnessFile).toHaveBeenCalledExactlyOnceWith('fit-1')
    // The unguarded delete would remove a file a post uses.
    expect(deleteFitnessFile).not.toHaveBeenCalled()

    vi.mocked(deleteUnpostedFitnessFile).mockClear()
    await deleteDraftAndOwnedMedia(
      await store({ id: 'd2', fitnessFile: fitness(), attemptedAt: 5 })
    )
    await deleteDraftAndOwnedMedia(
      await store({ id: 'd3', fitnessFile: fitness({ owned: false }) })
    )
    await deleteDraftAndOwnedMedia(
      await store({
        id: 'd4',
        fitnessFile: fitness({ fitnessFileId: undefined })
      })
    )
    expect(deleteUnpostedFitnessFile).not.toHaveBeenCalled()
  })

  it('deletes nothing for a locked draft, whose media is no longer owned', async () => {
    const saved = await store({
      lockedMessage: 'Saved on the server',
      attemptedAt: 5,
      attachments: [attachment({ mediaId: 'm1', owned: false })],
      fitnessFile: fitness({ owned: false })
    })

    await deleteDraftAndOwnedMedia(saved)

    expect(await getDraft('d1')).toBeUndefined()
    expect(deleteUnpostedMedia).not.toHaveBeenCalled()
    expect(deleteUnpostedFitnessFile).not.toHaveBeenCalled()
  })

  it('does not touch media when deleting the record fails', async () => {
    const saved = await store({ attachments: [attachment({ mediaId: 'm1' })] })
    setDraftsIndexedDBFactory(null) // no indexedDB in this environment

    await expect(deleteDraftAndOwnedMedia(saved)).rejects.toBeInstanceOf(
      DraftsUnavailableError
    )
    expect(deleteUnpostedMedia).not.toHaveBeenCalled()
  })

  it('deletes no media when another tab already posted and released the draft', async () => {
    // Tab B holds this unattempted snapshot; tab A posts (attemptedAt set,
    // saved), then releases the draft, deleting the row.
    const staleSnapshot = await store({
      attachments: [attachment({ mediaId: 'm1' })],
      fitnessFile: fitness()
    })
    await saveDraft(
      { ...staleSnapshot, attemptedAt: 5 },
      { expectedRevision: staleSnapshot.revision, epoch: 0 }
    )
    await deleteDraft('d1')

    await deleteDraftAndOwnedMedia(staleSnapshot)

    expect(deleteUnpostedFitnessFile).not.toHaveBeenCalled()
    expect(deleteUnpostedMedia).not.toHaveBeenCalled()
  })

  it('rejects on a revision conflict and deletes neither the row nor any media', async () => {
    const staleSnapshot = await store({ fitnessFile: fitness() })
    await saveDraft(
      { ...staleSnapshot, attemptedAt: 5 },
      { expectedRevision: staleSnapshot.revision, epoch: 0 }
    )

    await expect(
      deleteDraftAndOwnedMedia(staleSnapshot)
    ).rejects.toBeInstanceOf(DraftConflictError)

    expect(await getDraft('d1')).toBeDefined()
    expect(deleteUnpostedFitnessFile).not.toHaveBeenCalled()
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
