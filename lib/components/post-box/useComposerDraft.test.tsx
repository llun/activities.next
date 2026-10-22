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
const requestDrain = vi.fn()
const context = (patch = {}) => ({
  accountId: 'account-1',
  actorId: 'actor-1',
  epoch: 0,
  count: 0,
  signingOut: false,
  notifySavedToDrafts,
  requestDrain,
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

// A second tab (the Drafts page editor) that opens `draft` and saves `text`.
const editElsewhere = async (draft: DraftRecord, text: string) => {
  const other: DraftContent = { ...content(), ...draft, text }
  const tab = renderHook(() =>
    useComposerDraft({ composer: 'post-box', draft, getContent: () => other })
  )
  act(() => tab.result.current.schedule())
  await advance(DRAFT_SAVE_DEBOUNCE_MS)
  await vi.waitFor(() => expect(tab.result.current.saveState).toBe('saved'))
  return tab
}

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
    requestDrain.mockReset()
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

  it('the draft it let go of never sets the new draft’s status', async () => {
    const { result } = setup()
    act(() => result.current.schedule())
    // Re-targeted: the old draft is still being saved when the composer moves on.
    let detached: Promise<void> = Promise.resolve()
    act(() => {
      detached = result.current.detach()
    })
    current = null
    await act(async () => {
      await detached
    })

    expect((await stored())?.text).toBe('hello')
    expect(result.current.saveState).toBe('idle')
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

  describe('two tabs on one draft', () => {
    const key = { key: 'key-1', fingerprint: 'fp-1' }
    const newKey = { key: 'key-2', fingerprint: 'fp-2' }

    // This tab saves, then another tab changes the stored draft (`change`).
    const savedThenChanged = async (
      change: (draft: DraftRecord) => Promise<unknown>
    ) => {
      const hook = setup()
      act(() => hook.result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() =>
        expect(hook.result.current.saveState).toBe('saved')
      )
      const original = await stored()
      await change(original)
      return { ...hook, original }
    }

    // Types `text`, waits for the conflict, and checks Post is blocked.
    const typeIntoConflict = async (
      result: { current: ReturnType<typeof useComposerDraft> },
      text: string
    ) => {
      current = content({ text })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
      await act(async () => {
        await expect(result.current.recordAttempt(key)).resolves.toBe(false)
      })
    }

    // Empties the composer, then types `text` as a new draft.
    const emptyThenType = async (
      result: { current: ReturnType<typeof useComposerDraft> },
      text: string
    ) => {
      current = null
      act(() => result.current.schedule())
      expect(result.current.saveState).toBe('idle')
      expect(result.current.draftId).toBeNull()
      current = content({ text })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
    }

    it("stops on a conflict: Not saved, Post blocked, and the other tab's record unchanged", async () => {
      let tabB: ReturnType<typeof renderHook> | undefined
      const { result, original } = await savedThenChanged(async (draft) => {
        tabB = await editElsewhere(draft, 'written in the other tab')
      })
      const before = await getDraft(original.id)

      await typeIntoConflict(result, 'typed here')

      // Later edits do not try again either.
      current = content({ text: 'typed here, more' })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS * 2)
      expect(result.current.saveState).toBe('error')
      expect(result.current.draftId).toBe(original.id)
      expect(await listDrafts({ actorId: 'actor-1' })).toEqual([before])
      tabB?.unmount()
    })

    it('emptying a conflicted composer unlocks it: new text is a new draft that sends once under a new key', async () => {
      let tabB: ReturnType<typeof renderHook> | undefined
      const { result, original } = await savedThenChanged(async (draft) => {
        tabB = await editElsewhere(draft, 'written in the other tab')
      })
      const before = await getDraft(original.id)
      await typeIntoConflict(result, 'typed here')

      await emptyThenType(result, 'a fresh start')

      const fresh = result.current.draftId as string
      expect(fresh).not.toBe(original.id)
      expect((await getDraft(fresh))?.text).toBe('a fresh start')
      await act(async () => {
        await expect(result.current.recordAttempt(newKey)).resolves.toBe(true)
      })
      expect((await getDraft(fresh))?.submit).toEqual(newKey)
      await act(async () => {
        await result.current.release()
      })
      expect(await listDrafts({ actorId: 'actor-1' })).toEqual([before])
      tabB?.unmount()
    })

    it.each<[string, (draft: DraftRecord) => Promise<unknown>]>([
      [
        'holds a send key',
        async (draft) => {
          const tab = renderHook(() =>
            useComposerDraft({
              composer: 'post-box',
              draft,
              getContent: () => ({ ...content(), ...draft })
            })
          )
          await act(async () => {
            await tab.result.current.recordAttempt(key)
          })
          tab.unmount()
        }
      ],
      [
        'was deleted',
        async (draft) => {
          const { deleteDraft } = await import('@/lib/client/drafts')
          await deleteDraft(draft.id)
        }
      ],
      [
        'was sent and released',
        async (draft) => {
          const tab = renderHook(() =>
            useComposerDraft({
              composer: 'post-box',
              draft,
              getContent: () => ({ ...content(), ...draft })
            })
          )
          await act(async () => {
            await tab.result.current.release()
          })
          tab.unmount()
        }
      ]
    ])(
      'when the draft %s in another tab: no new record and no send until the composer is emptied',
      async (_name, change) => {
        const { result, original } = await savedThenChanged(change)
        const before = await listDrafts({ actorId: 'actor-1' })

        await typeIntoConflict(result, 'typed here')
        // Bytes attached meanwhile are not stored under the other draft.
        act(() =>
          result.current.attachBlob(
            'local-late',
            new File(['bytes'], 'late.png', { type: 'image/png' })
          )
        )
        await advance(DRAFT_SAVE_DEBOUNCE_MS)
        expect(await getDraftBlob('local-late')).toBeUndefined()
        expect(await listDrafts({ actorId: 'actor-1' })).toEqual(before)

        await emptyThenType(result, 'a fresh start')

        expect(result.current.draftId).not.toBe(original.id)
        await act(async () => {
          await expect(result.current.recordAttempt(newKey)).resolves.toBe(true)
        })
        const all = await listDrafts({ actorId: 'actor-1' })
        expect(all).toHaveLength(before.length + 1)
        expect(all).toEqual(expect.arrayContaining(before))
      }
    )

    describe("leaving a conflicted composer keeps the other tab's record and bytes", () => {
      const conflictedWithBytes = async () => {
        const hook = setup()
        current = content({
          attachments: [attachment({ localId: 'local-2', mediaId: undefined })]
        })
        act(() =>
          hook.result.current.attachBlob(
            'local-2',
            new File(['bytes'], 'b.png', { type: 'image/png' })
          )
        )
        act(() => hook.result.current.schedule())
        await advance(DRAFT_SAVE_DEBOUNCE_MS)
        await vi.waitFor(() =>
          expect(hook.result.current.saveState).toBe('saved')
        )
        const original = await stored()
        const tabB = await editElsewhere(original, 'written in the other tab')
        const before = await getDraft(original.id)
        current = { ...current, text: 'typed here' } as DraftContent
        act(() => hook.result.current.schedule())
        await advance(DRAFT_SAVE_DEBOUNCE_MS)
        await vi.waitFor(() =>
          expect(hook.result.current.saveState).toBe('error')
        )
        const untouched = async () => {
          expect(await listDrafts({ actorId: 'actor-1' })).toEqual([before])
          expect((await getDraftBlob('local-2'))?.draftId).toBe(original.id)
          expect(deleteUnpostedMedia).not.toHaveBeenCalled()
        }
        return { ...hook, tabB, untouched }
      }

      it('Discard', async () => {
        const { result, tabB, untouched } = await conflictedWithBytes()

        await act(async () => {
          await result.current.discard()
        })

        await untouched()
        expect(result.current.saveState).toBe('idle')
        expect(result.current.draftId).toBeNull()
        tabB.unmount()
      })

      it('Cancel: the note offers the text, and the emptied composer starts afresh', async () => {
        const { result, tabB, untouched } = await conflictedWithBytes()

        await act(async () => {
          await expect(result.current.keep()).resolves.toBe(false)
        })
        expect(notifyNotSavedToDrafts).toHaveBeenCalledWith('typed here')
        expect(notifySavedToDrafts).not.toHaveBeenCalled()
        // The composer clears its text after Cancel.
        current = null
        act(() => result.current.schedule())
        await advance(DRAFT_SAVE_DEBOUNCE_MS)

        await untouched()
        expect(result.current.saveState).toBe('idle')
        expect(result.current.draftId).toBeNull()
        tabB.unmount()
      })
    })
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

  it('stays on "error" while storage keeps failing, so the alert is not repeated', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const states: string[] = []
    const { result } = renderHook(() => {
      const draft = useComposerDraft({
        composer: 'post-box',
        getContent: () => current
      })
      states.push(draft.saveState)
      return draft
    })
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await vi.waitFor(() => expect(result.current.saveState).toBe('error'))
    const failedAt = states.length

    current = content({ text: 'still typing' })
    act(() => result.current.schedule())
    await advance(DRAFT_SAVE_DEBOUNCE_MS)
    await act(async () => {
      await result.current.flush()
    })

    expect(states.slice(failedAt)).not.toContain('saving')
    expect(result.current.saveState).toBe('error')
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

    it('blocks the send on a revision conflict and leaves the other record as it is', async () => {
      const { result } = setup()
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      const draft = await stored()
      await saveDraft(draft, { expectedRevision: 1, epoch: 0 })

      await act(async () => {
        await expect(result.current.recordAttempt(key)).resolves.toBe(false)
      })

      const all = await listDrafts({ actorId: 'actor-1' })
      expect(all).toHaveLength(1)
      expect(all[0].submit).toBeUndefined()
      expect(all[0].attemptedAt).toBeUndefined()
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
      const put = vi.spyOn(IDBObjectStore.prototype, 'put')
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

      // Not written at all, not merely deleted afterwards.
      const blobPuts = put.mock.contexts.filter(
        (store) => (store as IDBObjectStore).name === 'blobs'
      )
      expect(blobPuts).toHaveLength(0)
      expect(await getDraftBlob('local-2')).toBeUndefined()
    })

    it('stores bytes attached while an emptied draft is deleted under the draft that follows', async () => {
      const { result } = setup()
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      const old = await stored()

      current = null
      act(() => result.current.schedule())
      await act(async () => {
        const emptied = result.current.flush()
        result.current.attachBlob('local-1', file)
        await emptied
      })
      await vi.waitFor(async () =>
        expect(await getDraftBlob('local-1')).toBeDefined()
      )
      const blob = await getDraftBlob('local-1')
      expect(blob?.draftId).not.toBe(old.id)

      current = content({ attachments: [attachment({ mediaId: undefined })] })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      const next = await stored()
      expect(next.id).toBe(blob?.draftId)
      expect(next.attachments[0].hasBlob).toBe(true)
    })

    it('release drops the bytes of a draft that was never stored', async () => {
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
        await result.current.release()
      })

      await vi.waitFor(async () =>
        expect(await getDraftBlob('local-1')).toBeUndefined()
      )
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

    it('keeps a deferred delete while a save that still holds the media lands', async () => {
      const { result } = setup()
      current = content({ attachments: [attachment()] })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))
      const del = vi.fn().mockResolvedValue(undefined)

      current = content({ text: 'b', attachments: [attachment()] })
      act(() => result.current.schedule())
      let flushing: Promise<void> = Promise.resolve()
      act(() => {
        flushing = result.current.flush()
        // The photo is removed while the save that still holds it is in flight.
        expect(result.current.deferServerDelete('media-1', del)).toBe(true)
      })
      await act(async () => {
        await flushing
      })
      expect(del).not.toHaveBeenCalled()

      current = content({ text: 'c' })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(del).toHaveBeenCalledTimes(1))
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
      // The kept revision: the note's baseline for "changed in another tab".
      expect(notifySavedToDrafts).toHaveBeenCalledWith(draft.id, 1)
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

    it('saves what was typed during a sign-out another tab cancelled', async () => {
      const { result, rerender } = setup()
      act(() => result.current.schedule())
      vi.mocked(useDrafts).mockReturnValue(context({ signingOut: true }))
      rerender()
      current = content({ text: 'typed while signing out' })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)

      vi.mocked(useDrafts).mockReturnValue(context())
      rerender()
      await advance(DRAFT_SAVE_DEBOUNCE_MS)

      await vi.waitFor(async () =>
        expect((await stored())?.text).toBe('typed while signing out')
      )
    })

    it('does not save into another account that took over the tab', async () => {
      vi.mocked(useDrafts).mockReturnValue(context({ signingOut: true }))
      const { result, rerender } = setup()
      act(() => result.current.schedule())

      vi.mocked(useDrafts).mockReturnValue(
        context({ accountId: 'account-2', actorId: 'actor-2' })
      )
      rerender()
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await act(async () => {
        await result.current.flush()
      })

      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
      expect(await listDrafts({ actorId: 'actor-2' })).toHaveLength(0)
    })

    it('a send while signing out never releases an earlier send’s draft', async () => {
      const { result, rerender } = setup()
      // The first send fails: its draft stays, kept when the composer moves on.
      await act(async () => {
        await result.current.recordAttempt({ key: 'k1', fingerprint: 'f1' })
      })
      await act(async () => {
        await result.current.detach()
      })
      expect(await stored()).toBeDefined()

      // The next send happens while another tab is signing out (no checkpoint),
      // and that sign-out is cancelled before it succeeds.
      current = content({ text: 'the second post' })
      vi.mocked(useDrafts).mockReturnValue(context({ signingOut: true }))
      rerender()
      await act(async () => {
        await result.current.recordAttempt({ key: 'k2', fingerprint: 'f2' })
      })
      vi.mocked(useDrafts).mockReturnValue(context())
      rerender()
      await act(async () => {
        await result.current.release()
      })

      expect((await stored())?.text).toBe('hello')
    })

    it('a stored draft still owns its media while another tab signs out, and is let go of on a re-target', async () => {
      const { result, rerender } = setup()
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() => expect(result.current.saveState).toBe('saved'))

      vi.mocked(useDrafts).mockReturnValue(context({ signingOut: true }))
      rerender()
      expect(result.current.hasDraft()).toBe(true)

      await act(async () => {
        await result.current.detach()
      })
      expect(result.current.hasDraft()).toBe(false)
    })

    it('keep offers the text when another tab is signing out', async () => {
      vi.mocked(useDrafts).mockReturnValue(context({ signingOut: true }))
      const { result } = setup()

      await act(async () => {
        await expect(result.current.keep()).resolves.toBe(false)
      })

      expect(notifyNotSavedToDrafts).toHaveBeenCalledWith('hello')
      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
    })

    it('keep does not claim a save skipped while a reopened draft is loading', async () => {
      const first = setup()
      act(() => first.result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() =>
        expect(first.result.current.saveState).toBe('saved')
      )
      first.unmount()
      const reopened = await stored()
      const { result } = renderHook(() =>
        useComposerDraft({
          composer: 'post-box',
          draft: reopened,
          isSeeding: () => true,
          getContent: () => current
        })
      )
      current = content({ text: 'typed while loading' })

      await act(async () => {
        await expect(result.current.keep()).resolves.toBe(false)
      })

      expect(notifySavedToDrafts).not.toHaveBeenCalled()
      expect(notifyNotSavedToDrafts).toHaveBeenCalledWith('typed while loading')
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
      expect(notifySavedToDrafts).toHaveBeenCalledWith(draft.id, draft.revision)
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

  describe('handOff', () => {
    const handOff = async (
      result: { current: ReturnType<typeof useComposerDraft> },
      queue: boolean
    ) => {
      let handedOff: boolean | undefined
      await act(async () => {
        handedOff = await result.current.handOff({ queue })
      })
      return handedOff
    }

    it('queue: writes state waiting in one save, forgets the draft and asks for a drain', async () => {
      const { result } = setup()

      await expect(handOff(result, true)).resolves.toBe(true)

      const draft = await stored()
      expect(draft.revision).toBe(1)
      expect(draft.queue).toEqual({
        state: 'waiting',
        queuedAt: Date.now(),
        attempts: 0
      })
      expect(notifySavedToDrafts).toHaveBeenCalledWith(draft.id, 1, {
        queued: true
      })
      expect(requestDrain).toHaveBeenCalledTimes(1)
      // Let go: the next content is a new draft and the queued one is untouched.
      expect(result.current.hasDraft()).toBe(false)
      current = content({ text: 'the next one' })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(async () =>
        expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(2)
      )
      expect(await getDraft(draft.id)).toEqual(draft)
    })

    it('queue: a draft holding an attempt enters as checking, from its attempt time', async () => {
      const { result } = setup()
      await act(async () => {
        await result.current.recordLock('kept it', {
          key: 'key-1',
          fingerprint: 'fp-1'
        })
      })
      const attemptedAt = (await stored()).attemptedAt

      await expect(handOff(result, true)).resolves.toBe(true)

      const draft = await stored()
      expect(draft.queue).toEqual({
        state: 'checking',
        queuedAt: Date.now(),
        attempts: 0,
        firstAttemptAt: attemptedAt
      })
      expect(draft.submit).toEqual({ key: 'key-1', fingerprint: 'fp-1' })
    })

    it('save draft: keeps no queue, does not ask for a drain, and forgets the draft', async () => {
      const { result } = setup()

      await expect(handOff(result, false)).resolves.toBe(true)

      const draft = await stored()
      expect(draft.queue).toBeUndefined()
      expect(notifySavedToDrafts).toHaveBeenCalledWith(draft.id, 1)
      expect(requestDrain).not.toHaveBeenCalled()
      expect(result.current.hasDraft()).toBe(false)
    })

    it('writes one queued revision when text is typed while the hand-off is in flight', async () => {
      const { result } = setup()
      act(() => result.current.schedule())

      let handedOff: Promise<boolean> | undefined
      act(() => {
        handedOff = result.current.handOff({ queue: true })
      })
      // Typed while the hand-off is in flight: the hand-off saves it, and the
      // debounce must not write a second (unqueued) revision behind it.
      current = content({ text: 'typed during the hand-off' })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS * 2)
      await act(async () => {
        await expect(handedOff).resolves.toBe(true)
      })

      const drafts = await listDrafts({ actorId: 'actor-1' })
      expect(drafts).toHaveLength(1)
      expect(drafts[0]).toMatchObject({
        text: 'typed during the hand-off',
        revision: 1,
        queue: { state: 'waiting' }
      })
      expect(notifySavedToDrafts).toHaveBeenCalledWith(drafts[0].id, 1, {
        queued: true
      })
    })

    it('stateFromDraft ignores a stored queue: a composer never holds a queued revision', async () => {
      const first = setup()
      await expect(handOff(first.result, true)).resolves.toBe(true)
      first.unmount()
      const queued = await stored()
      expect(queued.queue).toBeDefined()
      const { result } = setup({ draft: queued })

      current = content({ text: 'edited after reopening' })
      act(() => result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)

      await vi.waitFor(async () => expect((await stored()).revision).toBe(2))
      expect((await stored()).queue).toBeUndefined()
    })

    it.each([[true], [false]])(
      'returns false and writes nothing for an untouched composer (queue %s)',
      async (queue) => {
        // Like the composers: forced, an untouched composer still reads as a
        // (blank) draft, so only the hand-off's own guard stops the write.
        const { result } = renderHook(() =>
          useComposerDraft({
            composer: 'post-box',
            getContent: (force) => (force ? content({ text: '' }) : null)
          })
        )

        await expect(handOff(result, queue)).resolves.toBe(false)

        expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
        expect(notifySavedToDrafts).not.toHaveBeenCalled()
        expect(requestDrain).not.toHaveBeenCalled()
      }
    )

    it('returns false without a provider', async () => {
      vi.mocked(useDrafts).mockReturnValue(null)
      const { result } = setup()

      await expect(handOff(result, true)).resolves.toBe(false)

      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
    })

    it('returns false while a reopened draft is still loading', async () => {
      const { result } = renderHook(() =>
        useComposerDraft({
          composer: 'post-box',
          isSeeding: () => true,
          getContent: () => current
        })
      )

      await expect(handOff(result, true)).resolves.toBe(false)

      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
    })

    it("returns false on a conflict and leaves the other tab's record without a queue", async () => {
      let tabB: ReturnType<typeof renderHook> | undefined
      const hook = setup()
      act(() => hook.result.current.schedule())
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(() =>
        expect(hook.result.current.saveState).toBe('saved')
      )
      const original = await stored()
      tabB = await editElsewhere(original, 'written in the other tab')
      const before = await getDraft(original.id)
      current = content({ text: 'typed here' })

      await expect(handOff(hook.result, true)).resolves.toBe(false)

      expect(await getDraft(original.id)).toEqual(before)
      expect(before?.queue).toBeUndefined()
      expect(notifySavedToDrafts).not.toHaveBeenCalled()
      expect(requestDrain).not.toHaveBeenCalled()
      tabB?.unmount()
    })

    it('returns false when a photo whose bytes could not be stored is attached', async () => {
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
      // Not waited for: the hand-off itself waits for the pending blob write.
      await expect(handOff(result, true)).resolves.toBe(false)

      expect(await listDrafts({ actorId: 'actor-1' })).toHaveLength(0)
      expect(requestDrain).not.toHaveBeenCalled()
    })

    it('returns false when the save fails, and the next save is a plain draft', async () => {
      const put = vi
        .spyOn(IDBObjectStore.prototype, 'put')
        .mockImplementation(() => {
          throw new DOMException('full', 'QuotaExceededError')
        })
      const { result } = setup()

      await expect(handOff(result, true)).resolves.toBe(false)
      expect(notifySavedToDrafts).not.toHaveBeenCalled()
      expect(requestDrain).not.toHaveBeenCalled()

      put.mockRestore()
      await advance(DRAFT_SAVE_DEBOUNCE_MS)
      await vi.waitFor(async () => expect(await stored()).toBeDefined())
      expect((await stored()).queue).toBeUndefined()
      expect(result.current.hasDraft()).toBe(true)
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
