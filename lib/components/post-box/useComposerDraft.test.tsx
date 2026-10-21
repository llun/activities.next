/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'

import {
  DRAFTS_DB_NAME,
  type DraftRecord,
  getDraft,
  getDraftBlob,
  listDrafts,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { deleteFitnessFile } from '@/lib/client/fitnessRoutes'
import { deleteUnpostedMedia } from '@/lib/client/media'
import { useDrafts } from '@/lib/components/drafts/DraftsProvider'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import {
  DRAFT_SAVE_DEBOUNCE_MS,
  type DraftContent,
  useComposerDraft
} from './useComposerDraft'

vi.mock('@/lib/client/media', () => ({ deleteUnpostedMedia: vi.fn() }))
vi.mock('@/lib/client/fitnessRoutes', () => ({ deleteFitnessFile: vi.fn() }))
vi.mock('@/lib/components/drafts/DraftsProvider', () => ({
  useDrafts: vi.fn()
}))

const notifySavedToDrafts = vi.fn()
const notifyNotSavedToDrafts = vi.fn()
const context = (patch = {}) => ({
  accountId: 'account-1',
  actorId: 'actor-1',
  epoch: 0,
  count: 0,
  signingOut: false,
  savedDraftId: null,
  notifySavedToDrafts,
  notifyNotSavedToDrafts,
  ...patch
})

const content = (patch: Partial<DraftContent> = {}): DraftContent => ({
  text: 'hello',
  contentWarning: '',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: [],
  ...patch
})

const attachment = (patch = {}) => ({
  localId: 'local-1',
  mediaId: 'media-1',
  owned: true,
  mediaType: 'image/png',
  fileName: 'a.png',
  description: '',
  decorative: false,
  ...patch
})

let current: DraftContent | null
const setup = (options: { editing?: boolean; draft?: DraftRecord } = {}) =>
  renderHook(() =>
    useComposerDraft({
      composer: 'post-box',
      editing: options.editing,
      draft: options.draft,
      getContent: () => current
    })
  )

const stored = async () => (await listDrafts({ actorId: 'actor-1' }))[0]

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// Real IndexedDB (fake-indexeddb) needs real microtasks and immediates: only
// Date and the debounce's timers are faked.
const useFakeClock = () =>
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })

describe('useComposerDraft', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
    vi.mocked(useDrafts).mockReturnValue(context())
    vi.mocked(deleteUnpostedMedia)
      .mockReset()
      .mockResolvedValue(true as never)
    vi.mocked(deleteFitnessFile).mockReset().mockResolvedValue(undefined)
    notifySavedToDrafts.mockReset()
    notifyNotSavedToDrafts.mockReset()
    current = content()
    useFakeClock()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetDraftsChannelForTesting()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
    vi.unstubAllGlobals()
  })

  it('saves once the debounce has passed, and not a millisecond before', async () => {
    const { result } = setup()

    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS - 1)
    expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
    expect(result.current.saveState).toBe('saving')

    await advance(1)
    await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
    const draft = await stored()
    expect(draft.text).toBe('hello')
    expect(draft.revision).toBe(1)
    expect(result.current.draftId).toBe(draft.id)
  })

  it('writes one revision per distinct content and none for an unchanged one', async () => {
    const { result } = setup()
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))

    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
    expect((await stored()).revision).toBe(1)

    current = content({ text: 'hello again' })
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(async () => expect((await stored()).revision).toBe(2))
  })

  it('deletes the draft when the content becomes empty', async () => {
    const { result } = setup()
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))

    current = null
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(async () =>
      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
    )
    await vi.waitFor(() => expect(result.current.saveState).toBe('idle'))
    expect(result.current.draftId).toBeNull()
  })

  it.each([
    [
      'without a provider',
      () => vi.mocked(useDrafts).mockReturnValue(null),
      {}
    ],
    ['while editing a published post', () => undefined, { editing: true }],
    [
      'while another tab signs out',
      () => vi.mocked(useDrafts).mockReturnValue(context({ signingOut: true })),
      {}
    ]
  ])('does nothing %s', async (_name, arrange, options) => {
    arrange()
    const { result } = setup(options)

    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS * 2)
    await act(async () => {
      await result.current.flush()
    })

    expect(result.current.saveState).toBe('idle')
    expect(result.current.hasDraft()).toBe(false)
    expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
    await expect(
      result.current.recordAttempt({ key: 'k', fingerprint: 'f' })
    ).resolves.toBe(true)
    expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
  })

  it('flushes a pending save when the page is hidden', async () => {
    const { result } = setup()
    act(() => result.current.schedule())

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    try {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      // Drops the debounce timer still pending, unfired: only the flush itself
      // can have saved the draft (vi.waitFor would advance fake timers).
      vi.useRealTimers()
      await vi.waitFor(async () => expect((await stored())?.text).toBe('hello'))
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible'
      })
    }
  })

  it('shows "error" and never overwrites when another tab saved the draft first', async () => {
    const { result } = setup()
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
    const draft = await stored()
    // Another tab saves revision 2 of the same draft.
    await saveDraft(
      { ...draft, text: 'written in the other tab' },
      { expectedRevision: 1, epoch: 0 }
    )

    current = content({ text: 'typed here' })
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
    expect((await stored()).text).toBe('written in the other tab')

    // It has stopped for good: later edits do not try again.
    current = content({ text: 'typed here, more' })
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS * 2)
    expect((await stored()).text).toBe('written in the other tab')
    expect(result.current.saveState).toBe('error')
  })

  describe('a stale tab never deletes a newer revision another tab saved', () => {
    const savedThenEditedElsewhere = async () => {
      const hook = setup()
      act(() => hook.result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() =>
        expect(hook.result.current.saveState).toBe('saved')
      )
      const draft = await stored()
      // Another tab (the Drafts page) saves revision 2 of the same draft.
      await saveDraft(
        { ...draft, text: 'written in the other tab' },
        { expectedRevision: 1, epoch: 0 }
      )
      return hook
    }

    it('emptying the composer keeps it, and new text starts a new draft that can be sent', async () => {
      const { result } = await savedThenEditedElsewhere()
      const other = await stored()

      current = null
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('idle'))
      expect((await getDraft(other.id))?.text).toBe('written in the other tab')

      // The composer is not stuck: new text autosaves as a new draft.
      current = content({ text: 'a fresh start' })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      const all = await listDrafts({ actorId: 'actor-1' })
      expect(all.map((draft) => draft.text).sort()).toEqual([
        'a fresh start',
        'written in the other tab'
      ])

      // And Post is allowed.
      await act(async () => {
        await expect(
          result.current.recordAttempt({ key: 'key-1', fingerprint: 'fp-1' })
        ).resolves.toBe(true)
      })
      expect((await getDraft(other.id))?.text).toBe('written in the other tab')
    })

    it('release after a send keeps it', async () => {
      const { result } = await savedThenEditedElsewhere()

      await act(async () => {
        await result.current.release()
      })

      expect((await stored()).text).toBe('written in the other tab')
    })

    it('discarding an empty composer keeps it', async () => {
      const { result } = await savedThenEditedElsewhere()

      current = null
      await act(async () => {
        await result.current.discard()
      })

      expect((await stored()).text).toBe('written in the other tab')
    })
  })

  it('never recreates a draft another tab deleted', async () => {
    const { result } = setup()
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
    const { deleteDraft } = await import('@/lib/client/drafts')
    await deleteDraft((await stored()).id)

    current = content({ text: 'more' })
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
    expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
  })

  it('shows "error" when the account signed out under a stale tab (epoch)', async () => {
    vi.mocked(useDrafts).mockReturnValue(context({ epoch: 0 }))
    const { deleteAccountDrafts } = await import('@/lib/client/drafts')
    await deleteAccountDrafts('account-1')
    const { result } = setup()

    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
    expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
  })

  it('makes a full database visible instead of dropping the draft silently', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const { result } = setup()

    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)

    await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
  })

  it('shows "error" when the database cannot be opened', async () => {
    setDraftsIndexedDBFactory(null)
    vi.stubGlobal('indexedDB', undefined)
    const { result } = setup()

    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)

    await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
  })

  describe('the epoch', () => {
    it('writes nothing while the provider epoch is unresolved, and saves once it is', async () => {
      vi.mocked(useDrafts).mockReturnValue(context({ epoch: null }))
      const { result, rerender } = setup()

      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)

      vi.mocked(useDrafts).mockReturnValue(context({ epoch: 0 }))
      rerender()
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      expect((await stored()).text).toBe('hello')
    })

    it('never re-reads the epoch: a tab pinned before another tab signed out cannot write', async () => {
      vi.mocked(useDrafts).mockReturnValue(context({ epoch: 0 }))
      const { deleteAccountDrafts } = await import('@/lib/client/drafts')
      const { result } = setup()
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))

      await deleteAccountDrafts('account-1')
      current = content({ text: 'typed after the sign-out' })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)

      await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
    })
  })

  describe('hasDraft', () => {
    it('is false once every save failed and nothing was stored', async () => {
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })
      const { result } = setup()
      act(() => result.current.schedule())
      expect(result.current.hasDraft()).toBe(true)

      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('error'))

      expect(result.current.hasDraft()).toBe(false)
    })

    it('is true while a save is in flight and once a record is stored', async () => {
      const { result } = setup()
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      expect(result.current.hasDraft()).toBe(true)

      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      expect(result.current.hasDraft()).toBe(true)
    })
  })

  describe('before the POST (recordAttempt)', () => {
    const key = { key: 'key-1', fingerprint: 'fp-1' }

    it('writes the key and the attempt, then allows the send', async () => {
      const { result } = setup()

      await act(async () => {
        await expect(result.current.recordAttempt(key)).resolves.toBe(true)
      })

      const draft = await stored()
      expect(draft.submit).toEqual(key)
      expect(draft.attemptedAt).toEqual(expect.any(Number))
    })

    it('blocks the send when the checkpoint cannot be written over an older draft', async () => {
      const { result } = setup()
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })

      await act(async () => {
        await expect(result.current.recordAttempt(key)).resolves.toBe(false)
      })

      expect(result.current.saveState).toBe('error')
      expect((await stored()).submit).toBeUndefined()
    })

    it('blocks the send on a revision conflict', async () => {
      const { result } = setup()
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      const draft = await stored()
      await saveDraft(draft, { expectedRevision: 1, epoch: 0 })

      await act(async () => {
        await expect(result.current.recordAttempt(key)).resolves.toBe(false)
      })

      expect((await stored()).submit).toBeUndefined()
    })

    it('blocks the send when the account signed out', async () => {
      const { deleteAccountDrafts } = await import('@/lib/client/drafts')
      await deleteAccountDrafts('account-1')
      const { result } = setup()

      await act(async () => {
        await expect(result.current.recordAttempt(key)).resolves.toBe(false)
      })
    })

    it('still sends when storage never worked and no draft exists to resurrect', async () => {
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })
      const { result } = setup()

      await act(async () => {
        await expect(result.current.recordAttempt(key)).resolves.toBe(true)
      })

      expect(result.current.saveState).toBe('error')
    })
  })

  describe('media', () => {
    const file = new File(['bytes'], 'a.png', { type: 'image/png' })

    it('keeps the bytes after the upload id exists and drops them when the attachment goes', async () => {
      const { result } = setup()
      current = content({
        attachments: [attachment({ mediaId: undefined })]
      })
      act(() => result.current.attachBlob('local-1', file))
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      expect((await stored()).attachments[0].hasBlob).toBe(true)

      // The upload landed: the id is recorded, the bytes stay.
      current = content({ attachments: [attachment()] })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(async () =>
        expect((await stored()).attachments[0].mediaId).toBe('media-1')
      )
      expect(await getDraftBlob('local-1')).toBeDefined()

      // Removed from the composer: the next save drops the bytes.
      current = content({ attachments: [] })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(async () =>
        expect(await getDraftBlob('local-1')).toBeUndefined()
      )
    })

    it('shows "error" when the bytes cannot be stored and keeps showing it', async () => {
      const { result } = setup()
      current = content({
        attachments: [attachment({ mediaId: undefined })]
      })
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })

      act(() => result.current.attachBlob('local-1', file))

      await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
    })

    it('stops saying "error" once the attachment whose bytes failed is removed', async () => {
      const { result } = setup()
      current = content({
        attachments: [attachment({ mediaId: undefined })]
      })
      const put = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(() => {
          throw new DOMException('full', 'QuotaExceededError')
        })
      act(() => result.current.attachBlob('local-1', file))
      await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
      put.mockRestore()

      current = content({ attachments: [] })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)

      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      await act(async () => {
        await expect(result.current.keep()).resolves.toBe(true)
      })
    })

    it('deletes the bytes of an attachment removed before the first save', async () => {
      const { result } = setup()
      current = content({
        attachments: [attachment({ mediaId: undefined })]
      })
      act(() => result.current.attachBlob('local-1', file))
      await vi.waitFor(async () =>
        expect(await getDraftBlob('local-1')).toBeDefined()
      )

      current = null
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)

      await vi.waitFor(async () =>
        expect(await getDraftBlob('local-1')).toBeUndefined()
      )
      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
    })

    it('release deletes the draft and its bytes but never the media', async () => {
      const { result } = setup()
      current = content({ attachments: [attachment()] })
      act(() => result.current.attachBlob('local-1', file))
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))

      await act(async () => {
        await result.current.release()
      })

      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
      expect(await getDraftBlob('local-1')).toBeUndefined()
      expect(deleteUnpostedMedia).not.toHaveBeenCalled()
      expect(deleteFitnessFile).not.toHaveBeenCalled()
      expect(result.current.hasDraft()).toBe(false)
    })

    it('a late debounced save cannot bring a released draft back', async () => {
      const { result } = setup()
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      current = content({ text: 'typed after' })
      act(() => result.current.schedule())

      current = null
      await act(async () => {
        await result.current.release()
      })
      await advance(DRAFT_SAVE_DEBOUNCE_MS * 2)

      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
    })

    it('a blob write still queued when the draft is discarded stores nothing', async () => {
      const { result } = setup()
      current = content({
        attachments: [
          attachment({ mediaId: undefined }),
          attachment({ localId: 'local-2', mediaId: undefined })
        ]
      })
      act(() => result.current.attachBlob('local-1', file))
      act(() => result.current.attachBlob('local-2', file))

      await act(async () => {
        await result.current.discard()
      })

      expect(await getDraftBlob('local-2')).toBeUndefined()
    })

    it('discarding a draft that was never saved deletes its stored bytes', async () => {
      const { result } = setup()
      current = content({
        attachments: [attachment({ mediaId: undefined })]
      })
      act(() => result.current.attachBlob('local-1', file))
      await vi.waitFor(async () =>
        expect(await getDraftBlob('local-1')).toBeDefined()
      )
      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)

      await act(async () => {
        await result.current.discard()
      })

      await vi.waitFor(async () =>
        expect(await getDraftBlob('local-1')).toBeUndefined()
      )
    })

    it('a composer back to what is stored is saved again, so it can be kept', async () => {
      const { result } = setup()
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      // A photo whose bytes, and the record holding it, cannot be stored.
      const put = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(() => {
          throw new DOMException('full', 'QuotaExceededError')
        })
      current = content({ attachments: [attachment({ mediaId: undefined })] })
      act(() => result.current.attachBlob('local-1', file))
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
      put.mockRestore()

      // The photo is removed: the composer holds exactly the stored record.
      current = content()
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)

      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      await act(async () => {
        await expect(result.current.keep()).resolves.toBe(true)
      })
      expect(notifySavedToDrafts).toHaveBeenCalled()
    })

    it('discard deletes only the media the draft owns', async () => {
      const { result } = setup()
      current = content({
        attachments: [
          attachment({ mediaId: 'owned-media' }),
          attachment({
            localId: 'local-2',
            mediaId: 'kept-media',
            owned: false
          })
        ]
      })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))

      await act(async () => {
        await result.current.discard()
      })

      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
      expect(deleteUnpostedMedia).toHaveBeenCalledTimes(1)
      expect(deleteUnpostedMedia).toHaveBeenCalledWith('owned-media')
    })
  })

  describe('closing', () => {
    it('keep saves, notifies Drafts and stops autosaving', async () => {
      const { result } = setup()

      await act(async () => {
        await expect(result.current.keep()).resolves.toBe(true)
      })

      const draft = await stored()
      expect(notifySavedToDrafts).toHaveBeenCalledWith(draft.id)
      current = content({ text: 'typed after closing' })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS * 2)
      expect((await stored()).text).toBe('hello')
      expect(result.current.hasDraft()).toBe(true)
    })

    it('keep does not claim a save that failed', async () => {
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })
      const { result } = setup()

      await act(async () => {
        await expect(result.current.keep()).resolves.toBe(false)
      })

      expect(notifySavedToDrafts).not.toHaveBeenCalled()
      // Closing must not drop the text silently: the note offers it.
      expect(notifyNotSavedToDrafts).toHaveBeenCalledWith('hello')
    })

    it('keep says "Saved" when the record saved but a photo\'s bytes did not', async () => {
      const put = IDBObjectStore.prototype.put
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore['put']>
      ) {
        if (this.name === 'blobs') {
          throw new DOMException('full', 'QuotaExceededError')
        }
        return put.apply(this, args)
      })
      const { result } = setup()
      current = content({
        attachments: [attachment({ mediaId: undefined })]
      })
      act(() =>
        result.current.attachBlob(
          'local-1',
          new File(['bytes'], 'a.png', { type: 'image/png' })
        )
      )
      await vi.waitFor(() => expect(result.current.saveState).toBe('error'))

      await act(async () => {
        await expect(result.current.keep()).resolves.toBe(true)
      })

      const draft = await stored()
      expect(draft.attachments[0].hasBlob).toBe(false)
      expect(notifySavedToDrafts).toHaveBeenCalledWith(draft.id)
      expect(notifyNotSavedToDrafts).not.toHaveBeenCalled()
    })

    it('does not expose its internal timer', () => {
      const { result } = setup()
      expect(result.current).not.toHaveProperty('clearTimer')
    })

    it('detach saves what is there and lets the composer start a new draft', async () => {
      const { result } = setup()
      act(() => result.current.schedule())
      const first = await (async () => {
        await act(async () => {
          await result.current.detach()
        })
        return stored()
      })()
      expect(first.text).toBe('hello')

      current = content({ text: 'the next one' })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(async () =>
        expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(2)
      )
      expect((await getDraft(first.id))?.text).toBe('hello')
    })
  })

  it('persists a lock and the submit key with the draft', async () => {
    const { result } = setup()
    const submit = { key: 'key-1', fingerprint: 'fp-1' }

    await act(async () => {
      await result.current.recordLock('kept it', submit)
    })

    const draft = await stored()
    expect(draft.lockedMessage).toBe('kept it')
    expect(draft.submit).toEqual(submit)
    expect(draft.attemptedAt).toEqual(expect.any(Number))

    await act(async () => {
      await result.current.recordLock(null, null)
    })
    const unlocked = await stored()
    expect(unlocked.lockedMessage).toBeUndefined()
    expect(unlocked.submit).toBeUndefined()
  })

  it('continues the revisions of a draft it was given', async () => {
    const first = renderHook(() =>
      useComposerDraft({
        composer: 'post-box',
        getContent: () => current
      })
    )
    act(() => first.result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(first.result.current.saveState).toBe('saved'))
    first.unmount()
    const reopened = (await stored()) as DraftRecord

    const { result } = setup({ draft: reopened })
    current = content({ text: 'edited after reopening' })
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)

    await vi.waitFor(async () => expect((await stored()).revision).toBe(2))
    expect((await stored()).text).toBe('edited after reopening')
    expect(DRAFTS_DB_NAME).toBe('activities_drafts_v1')
  })
})
