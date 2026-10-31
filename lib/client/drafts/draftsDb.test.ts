import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'

import {
  clearAllOfflineData,
  saveClientBootstrapSnapshot,
  setIndexedDBFactory as setOfflineIndexedDBFactory
} from '@/lib/client/offline'

import {
  DRAFTS_OPEN_TIMEOUT_MS,
  DraftConflictError,
  DraftQuotaError,
  DraftSignedOutError,
  DraftsUnavailableError,
  countDrafts,
  countDraftsByState,
  deleteAccountDrafts,
  deleteDraft,
  deleteDraftBlob,
  deleteDraftIfRevision,
  getAccountEpoch,
  getDraft,
  getDraftBlob,
  listDrafts,
  putDraftBlob,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from './draftsDb'
import { DRAFTS_DB_NAME, type DraftRecord } from './types'

const draft = (patch: Partial<DraftRecord> & { id: string }): DraftRecord => ({
  accountId: 'account-1',
  actorId: 'actor-1',
  revision: 0,
  createdAt: 1,
  updatedAt: 1,
  composer: 'post-box',
  text: 'hello',
  contentWarning: '',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: [],
  ...patch
})

const blob = (id: string, draftId: string, bytes = [1, 2, 3]) => ({
  id,
  draftId,
  bytes: new Uint8Array(bytes).buffer,
  mimeType: 'image/png',
  fileName: `${id}.png`,
  lastModified: 5
})

const listIdbNames = async (factory: IDBFactory) =>
  (await factory.databases()).map((entry) => entry.name)

describe('draftsDb', () => {
  let factory: IDBFactory

  beforeEach(() => {
    factory = new IDBFactory()
    setDraftsIndexedDBFactory(factory)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
  })

  describe('save, get, list, count', () => {
    it('saves a first draft at revision 1 and reads it back', async () => {
      const saved = await saveDraft(draft({ id: 'a' }), {
        expectedRevision: 0,
        epoch: 0
      })

      expect(saved.revision).toBe(1)
      expect(await getDraft('a')).toEqual(saved)
      expect(await getDraft('missing')).toBeUndefined()
    })

    it('increments the revision on each save and stamps updatedAt', async () => {
      // Only the clock: fake-indexeddb needs the real timers.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(100)
      const first = await saveDraft(draft({ id: 'a' }), {
        expectedRevision: 0,
        epoch: 0
      })
      vi.setSystemTime(200)
      const second = await saveDraft(draft({ id: 'a', text: 'edited' }), {
        expectedRevision: first.revision,
        epoch: 0
      })

      expect([first.revision, second.revision]).toEqual([1, 2])
      expect([first.updatedAt, second.updatedAt]).toEqual([100, 200])
      expect((await getDraft('a'))?.text).toBe('edited')
    })

    it('lists an actor newest first and counts per actor and per account', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const save = (id: string, patch: Partial<DraftRecord>, now: number) => {
        vi.setSystemTime(now)
        return saveDraft(draft({ id, ...patch }), {
          expectedRevision: 0,
          epoch: 0
        })
      }
      await save('old', {}, 10)
      await save('new', {}, 30)
      await save('other-actor', { actorId: 'actor-2' }, 20)
      await save(
        'other-account',
        { accountId: 'account-2', actorId: 'actor-3' },
        40
      )

      expect(
        (await listDrafts({ actorId: 'actor-1' })).map((d) => d.id)
      ).toEqual(['new', 'old'])
      expect(await countDrafts({ actorId: 'actor-1' })).toBe(2)
      expect(await countDrafts({ actorId: 'nobody' })).toBe(0)
      expect(await countDrafts({ accountId: 'account-1' })).toBe(3)
      expect(await countDrafts({ accountId: 'account-2' })).toBe(1)
    })

    it('counts drafts partitioned by state into waiting and drafts', async () => {
      // Empty store handles non-existent actor and account
      expect(await countDraftsByState({ actorId: 'actor-1' })).toEqual({
        waiting: 0,
        drafts: 0,
        profiles: 0
      })
      expect(await countDraftsByState({ accountId: 'account-1' })).toEqual({
        waiting: 0,
        drafts: 0,
        profiles: 0
      })

      // 2 plain drafts for actor-1 (account-1)
      await saveDraft(draft({ id: 'plain-1' }), {
        expectedRevision: 0,
        epoch: 0
      })
      await saveDraft(draft({ id: 'plain-2' }), {
        expectedRevision: 0,
        epoch: 0
      })
      // 1 queued draft for actor-1 (account-1)
      await saveDraft(
        draft({
          id: 'queued-1',
          queue: { state: 'waiting', queuedAt: 10, attempts: 0 }
        }),
        { expectedRevision: 0, epoch: 0 }
      )
      // 1 queued draft for actor-2 (account-1)
      await saveDraft(
        draft({
          id: 'queued-2',
          actorId: 'actor-2',
          queue: { state: 'couldnt_send', queuedAt: 20, attempts: 3 }
        }),
        { expectedRevision: 0, epoch: 0 }
      )
      // 1 plain draft for actor-3 (account-2)
      await saveDraft(
        draft({
          id: 'plain-3',
          accountId: 'account-2',
          actorId: 'actor-3'
        }),
        { expectedRevision: 0, epoch: 0 }
      )

      // actorId scope
      expect(await countDraftsByState({ actorId: 'actor-1' })).toEqual({
        waiting: 1,
        drafts: 2,
        profiles: 1
      })
      expect(await countDraftsByState({ actorId: 'actor-2' })).toEqual({
        waiting: 1,
        drafts: 0,
        profiles: 1
      })
      expect(await countDraftsByState({ actorId: 'actor-3' })).toEqual({
        waiting: 0,
        drafts: 1,
        profiles: 1
      })
      expect(await countDraftsByState({ actorId: 'missing-actor' })).toEqual({
        waiting: 0,
        drafts: 0,
        profiles: 0
      })

      // accountId scope
      expect(await countDraftsByState({ accountId: 'account-1' })).toEqual({
        waiting: 2,
        drafts: 2,
        profiles: 2
      })
      expect(await countDraftsByState({ accountId: 'account-2' })).toEqual({
        waiting: 0,
        drafts: 1,
        profiles: 1
      })
      expect(
        await countDraftsByState({ accountId: 'missing-account' })
      ).toEqual({
        waiting: 0,
        drafts: 0,
        profiles: 0
      })
    })

    it('keeps an attachment record whole, including its upload id and the flag that its bytes are kept', async () => {
      const saved = await saveDraft(
        draft({
          id: 'a',
          attachments: [
            {
              localId: 'l1',
              mediaId: 'm1',
              owned: true,
              mediaType: 'image/png',
              fileName: 'one.png',
              url: 'https://llun.test/m1.png',
              description: 'alt',
              decorative: false,
              hasBlob: true
            }
          ]
        }),
        { expectedRevision: 0, epoch: 0 }
      )

      expect((await getDraft('a'))?.attachments).toEqual(saved.attachments)
    })
  })

  describe('revision conflicts', () => {
    it('rejects a stale expectedRevision and leaves the record unchanged', async () => {
      const first = await saveDraft(draft({ id: 'a' }), {
        expectedRevision: 0,
        epoch: 0
      })
      await saveDraft(draft({ id: 'a', text: 'tab B' }), {
        expectedRevision: first.revision,
        epoch: 0
      })

      await expect(
        saveDraft(draft({ id: 'a', text: 'tab A, stale' }), {
          expectedRevision: first.revision,
          epoch: 0
        })
      ).rejects.toBeInstanceOf(DraftConflictError)

      const stored = await getDraft('a')
      expect(stored?.text).toBe('tab B')
      expect(stored?.revision).toBe(2)
    })

    it('rejects a first save over an existing id', async () => {
      await saveDraft(draft({ id: 'a' }), { expectedRevision: 0, epoch: 0 })

      await expect(
        saveDraft(draft({ id: 'a', text: 'again' }), {
          expectedRevision: 0,
          epoch: 0
        })
      ).rejects.toBeInstanceOf(DraftConflictError)
    })

    it('does not resurrect a draft deleted elsewhere (missing record, expectedRevision > 0)', async () => {
      const saved = await saveDraft(draft({ id: 'a' }), {
        expectedRevision: 0,
        epoch: 0
      })
      await deleteDraft('a')

      await expect(
        saveDraft(draft({ id: 'a' }), {
          expectedRevision: saved.revision,
          epoch: 0
        })
      ).rejects.toBeInstanceOf(DraftConflictError)
      expect(await getDraft('a')).toBeUndefined()
    })
  })

  describe('epoch', () => {
    it('is 0 until an account signs out', async () => {
      expect(await getAccountEpoch('account-1')).toBe(0)
    })

    it('aborts a save from a tab that holds an old epoch', async () => {
      await deleteAccountDrafts('account-1')

      await expect(
        saveDraft(draft({ id: 'a' }), { expectedRevision: 0, epoch: 0 })
      ).rejects.toBeInstanceOf(DraftSignedOutError)
      expect(await getDraft('a')).toBeUndefined()
      await expect(
        saveDraft(draft({ id: 'a' }), { expectedRevision: 0, epoch: 1 })
      ).resolves.toMatchObject({ revision: 1 })
    })

    it('aborts a blob write from a tab that holds an old epoch', async () => {
      await deleteAccountDrafts('account-1')

      await expect(
        putDraftBlob(blob('l1', 'a'), { accountId: 'account-1', epoch: 0 })
      ).rejects.toBeInstanceOf(DraftSignedOutError)
      expect(await getDraftBlob('l1')).toBeUndefined()
    })

    it('deleteAccountDrafts removes only that account, returns the count and bumps its epoch', async () => {
      await saveDraft(draft({ id: 'a' }), { expectedRevision: 0, epoch: 0 })
      await saveDraft(draft({ id: 'b' }), { expectedRevision: 0, epoch: 0 })
      await saveDraft(
        draft({ id: 'c', accountId: 'account-2', actorId: 'actor-2' }),
        { expectedRevision: 0, epoch: 0 }
      )
      await putDraftBlob(blob('la', 'a'), { accountId: 'account-1', epoch: 0 })
      // Bytes written before the draft record itself was ever saved.
      await putDraftBlob(blob('lz', 'never-saved'), {
        accountId: 'account-1',
        epoch: 0
      })
      await putDraftBlob(blob('lc', 'c'), { accountId: 'account-2', epoch: 0 })

      expect(await deleteAccountDrafts('account-1')).toBe(2)

      expect(await countDrafts({ accountId: 'account-1' })).toBe(0)
      expect(await getDraftBlob('la')).toBeUndefined()
      expect(await getDraftBlob('lz')).toBeUndefined()
      expect(await getDraft('c')).toBeDefined()
      expect(await getDraftBlob('lc')).toBeDefined()
      expect(await getAccountEpoch('account-1')).toBe(1)
      expect(await getAccountEpoch('account-2')).toBe(0)
    })

    it('returns 0 and still bumps the epoch when the account has no drafts', async () => {
      expect(await deleteAccountDrafts('account-1')).toBe(0)
      expect(await getAccountEpoch('account-1')).toBe(1)
    })
  })

  describe('blobs', () => {
    it('round-trips an ArrayBuffer with its metadata', async () => {
      await putDraftBlob(
        {
          ...blob('l1', 'a', [9, 8, 7]),
          poster: {
            bytes: new Uint8Array([4]).buffer,
            mimeType: 'image/jpeg',
            fileName: 'poster.jpg'
          }
        },
        { accountId: 'account-1', epoch: 0 }
      )

      const stored = await getDraftBlob('l1')
      expect(Array.from(new Uint8Array(stored!.bytes))).toEqual([9, 8, 7])
      expect(stored).toMatchObject({
        id: 'l1',
        draftId: 'a',
        accountId: 'account-1',
        mimeType: 'image/png',
        fileName: 'l1.png',
        lastModified: 5
      })
      expect(Array.from(new Uint8Array(stored!.poster!.bytes))).toEqual([4])
    })

    it('deleteDraft removes the draft and its blobs, never another draft’s', async () => {
      await saveDraft(draft({ id: 'a' }), { expectedRevision: 0, epoch: 0 })
      await saveDraft(draft({ id: 'b' }), { expectedRevision: 0, epoch: 0 })
      await putDraftBlob(blob('la1', 'a'), { accountId: 'account-1', epoch: 0 })
      await putDraftBlob(blob('la2', 'a'), { accountId: 'account-1', epoch: 0 })
      await putDraftBlob(blob('lb', 'b'), { accountId: 'account-1', epoch: 0 })

      await deleteDraft('a')

      expect(await getDraft('a')).toBeUndefined()
      expect(await getDraftBlob('la1')).toBeUndefined()
      expect(await getDraftBlob('la2')).toBeUndefined()
      expect(await getDraft('b')).toBeDefined()
      expect(await getDraftBlob('lb')).toBeDefined()
    })

    it('deleteDraftIfRevision returns and removes the draft and its blobs, or touches nothing', async () => {
      const saved = await saveDraft(draft({ id: 'a' }), {
        expectedRevision: 0,
        epoch: 0
      })
      await putDraftBlob(blob('l1', 'a'), { accountId: 'account-1', epoch: 0 })

      await expect(deleteDraftIfRevision('a', 99)).rejects.toBeInstanceOf(
        DraftConflictError
      )
      expect(await getDraft('a')).toBeDefined()
      expect(await getDraftBlob('l1')).toBeDefined()

      expect(await deleteDraftIfRevision('a', saved.revision)).toEqual(saved)
      expect(await getDraft('a')).toBeUndefined()
      expect(await getDraftBlob('l1')).toBeUndefined()
      expect(await deleteDraftIfRevision('a', saved.revision)).toBeUndefined()
    })

    it('deleteDraftBlob removes one blob', async () => {
      await putDraftBlob(blob('l1', 'a'), { accountId: 'account-1', epoch: 0 })

      await deleteDraftBlob('l1')

      expect(await getDraftBlob('l1')).toBeUndefined()
    })

    it('keeps an attachment’s bytes once its upload id exists, until the draft is deleted', async () => {
      await putDraftBlob(blob('l1', 'a'), { accountId: 'account-1', epoch: 0 })
      const first = await saveDraft(
        draft({
          id: 'a',
          attachments: [
            {
              localId: 'l1',
              owned: true,
              mediaType: 'image/png',
              fileName: 'l1.png',
              description: '',
              decorative: false,
              hasBlob: true
            }
          ]
        }),
        { expectedRevision: 0, epoch: 0 }
      )

      // The upload was confirmed: the id is recorded, the bytes are not dropped.
      await saveDraft(
        draft({
          id: 'a',
          attachments: [{ ...first.attachments[0], mediaId: 'm1' }]
        }),
        { expectedRevision: first.revision, epoch: 0 }
      )

      const stored = await getDraft('a')
      expect(stored?.attachments[0]).toMatchObject({
        mediaId: 'm1',
        hasBlob: true
      })
      expect(await getDraftBlob('l1')).toBeDefined()

      await deleteDraft('a')
      expect(await getDraftBlob('l1')).toBeUndefined()
    })
  })

  describe('failures', () => {
    it('maps a QuotaExceededError from a write to DraftQuotaError', async () => {
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })

      await expect(
        saveDraft(draft({ id: 'a' }), { expectedRevision: 0, epoch: 0 })
      ).rejects.toBeInstanceOf(DraftQuotaError)
      await expect(
        putDraftBlob(blob('l1', 'a'), { accountId: 'account-1', epoch: 0 })
      ).rejects.toBeInstanceOf(DraftQuotaError)
    })

    it('rejects with DraftsUnavailableError when indexedDB is missing', async () => {
      setDraftsIndexedDBFactory(null)

      await expect(getDraft('a')).rejects.toBeInstanceOf(DraftsUnavailableError)
    })

    it('reports an open error as unavailable, never deletes the database, and retries the open on the next call', async () => {
      const deleteDatabase = vi.fn()
      let opens = 0
      const flaky = {
        open: (name: string, version?: number) => {
          opens += 1
          if (opens > 1) return factory.open(name, version)
          const request = {} as IDBOpenDBRequest
          queueMicrotask(() => request.onerror?.(new Event('error')))
          return request
        },
        deleteDatabase
      } as unknown as IDBFactory
      setDraftsIndexedDBFactory(flaky)

      await expect(getDraft('a')).rejects.toBeInstanceOf(DraftsUnavailableError)
      await expect(
        saveDraft(draft({ id: 'a' }), { expectedRevision: 0, epoch: 0 })
      ).resolves.toMatchObject({ revision: 1 })

      expect(opens).toBe(2)
      expect(deleteDatabase).not.toHaveBeenCalled()
    })

    it('reports a blocked open as unavailable without deleting the database', async () => {
      const deleteDatabase = vi.fn()
      const blocked = {
        open: () => {
          const request = {} as IDBOpenDBRequest
          queueMicrotask(() =>
            request.onblocked?.(new Event('blocked') as never)
          )
          return request
        },
        deleteDatabase
      } as unknown as IDBFactory
      setDraftsIndexedDBFactory(blocked)

      await expect(getDraft('a')).rejects.toBeInstanceOf(DraftsUnavailableError)
      expect(deleteDatabase).not.toHaveBeenCalled()
    })

    it('reports an open that takes DRAFTS_OPEN_TIMEOUT_MS as unavailable', async () => {
      vi.useFakeTimers()
      const hanging = {
        open: () => ({}) as IDBOpenDBRequest,
        deleteDatabase: vi.fn()
      } as unknown as IDBFactory
      setDraftsIndexedDBFactory(hanging)
      let outcome: unknown = 'pending'
      getDraft('a').catch((error) => {
        outcome = error
      })

      await vi.advanceTimersByTimeAsync(DRAFTS_OPEN_TIMEOUT_MS - 1)
      expect(outcome).toBe('pending')

      await vi.advanceTimersByTimeAsync(1)
      expect(outcome).toBeInstanceOf(DraftsUnavailableError)
      expect(hanging.deleteDatabase).not.toHaveBeenCalled()
    })

    it('clears the open timeout when the drafts database is reset', async () => {
      vi.useFakeTimers()
      const hanging = {
        open: () => ({}) as IDBOpenDBRequest,
        deleteDatabase: vi.fn()
      } as unknown as IDBFactory
      setDraftsIndexedDBFactory(hanging)
      const pending = getDraft('a')
      await vi.advanceTimersByTimeAsync(0)

      expect(vi.getTimerCount()).toBe(1)
      resetDraftsDbForTesting()
      await expect(pending).rejects.toBeInstanceOf(DraftsUnavailableError)
      expect(vi.getTimerCount()).toBe(0)
    })

    it('never calls deleteDatabase while working normally', async () => {
      const deleteDatabase = vi.spyOn(factory, 'deleteDatabase')

      await saveDraft(draft({ id: 'a' }), { expectedRevision: 0, epoch: 0 })
      await deleteAccountDrafts('account-1')

      expect(deleteDatabase).not.toHaveBeenCalled()
    })
  })

  describe('isolation from the offline cache', () => {
    it('clearAllOfflineData leaves activities_drafts_v1 intact', async () => {
      setOfflineIndexedDBFactory(factory)
      try {
        await saveDraft(draft({ id: 'a' }), { expectedRevision: 0, epoch: 0 })
        await putDraftBlob(blob('l1', 'a'), {
          accountId: 'account-1',
          epoch: 0
        })
        await saveClientBootstrapSnapshot({
          accountId: 'account-1',
          actorId: 'actor-1'
        } as never)

        await clearAllOfflineData()

        expect(await listIdbNames(factory)).toContain(DRAFTS_DB_NAME)
        expect(await getDraft('a')).toBeDefined()
        expect(await getDraftBlob('l1')).toBeDefined()
        expect(await getAccountEpoch('account-1')).toBe(0)
      } finally {
        setOfflineIndexedDBFactory(null)
      }
    })
  })
})
