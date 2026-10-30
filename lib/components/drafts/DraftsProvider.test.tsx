/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'

import {
  type DraftRecord,
  deleteAccountDrafts,
  getDraft,
  postDraftsMessage,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import { DraftsProvider, useDrafts, useSendQueueStatus } from './DraftsProvider'

const draft = (id: string, actorId = 'actor-1'): DraftRecord => ({
  id,
  accountId: 'account-1',
  actorId,
  revision: 0,
  createdAt: 1,
  updatedAt: 1,
  composer: 'post-box',
  text: 'hello',
  contentWarning: '',
  contentWarningVisible: false,
  visibility: 'public',
  quoteApprovalPolicy: 'public',
  attachments: []
})

const Probe = () => {
  const drafts = useDrafts()
  if (!drafts) return <p data-testid="probe">none</p>
  return (
    <p data-testid="probe">
      {`count=${drafts.count} epoch=${drafts.epoch} signingOut=${drafts.signingOut} actor=${drafts.actorId}`}
    </p>
  )
}

const renderProvider = (props: { accountId?: string; actorId?: string } = {}) =>
  render(
    <DraftsProvider
      accountId={props.accountId ?? 'account-1'}
      actorId={props.actorId ?? 'actor-1'}
    >
      <Probe />
    </DraftsProvider>
  )

describe('DraftsProvider', () => {
  beforeEach(() => {
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
  })

  afterEach(() => {
    resetDraftsChannelForTesting()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
    vi.unstubAllGlobals()
  })

  it('is null for a signed-in actor without an account id', async () => {
    renderProvider({ accountId: '' })

    await act(async () => {})

    expect(screen.getByTestId('probe')).toHaveTextContent('none')
  })

  it('reads the epoch and counts this actor’s drafts on mount', async () => {
    await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })
    await saveDraft(draft('b', 'actor-2'), { expectedRevision: 0, epoch: 0 })

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent(
        'count=1 epoch=0 signingOut=false actor=actor-1'
      )
    )
  })

  it('re-counts on a changed message for this account, and ignores other accounts', async () => {
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('count=0 epoch=0')
    )
    await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })

    await act(async () => {
      postDraftsMessage({
        type: 'changed',
        accountId: 'another-account',
        actorId: 'actor-1',
        draftId: 'a'
      })
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('count=0')

    await act(async () => {
      postDraftsMessage({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'actor-1',
        draftId: 'a'
      })
    })
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('count=1')
    )
  })

  it('sets signingOut on signing-out and clears it on sign-out-cancelled, for its own account only', async () => {
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('epoch=0')
    )

    act(() => {
      postDraftsMessage({ type: 'signing-out', accountId: 'another-account' })
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('signingOut=false')

    act(() => {
      postDraftsMessage({ type: 'signing-out', accountId: 'account-1' })
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('signingOut=true')

    act(() => {
      postDraftsMessage({ type: 'sign-out-cancelled', accountId: 'account-1' })
    })
    expect(screen.getByTestId('probe')).toHaveTextContent('signingOut=false')
  })

  it('re-counts when the tab becomes visible again', async () => {
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('count=0')
    )
    await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('count=1')
    )
  })

  it('reads the bumped epoch after a sign-out', async () => {
    await deleteAccountDrafts('account-1')

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('epoch=1')
    )
  })

  it('counts 0 and keeps rendering when storage is unavailable', async () => {
    setDraftsIndexedDBFactory(null)

    renderProvider()
    await act(async () => {})

    expect(screen.getByTestId('probe')).toHaveTextContent('count=0 epoch=null')
  })

  describe('a purge pending from an earlier sign-out', () => {
    const KEY = 'activities-drafts-pending-purge'
    afterEach(() => window.localStorage.clear())

    it('is finished before the epoch is read, and this account sees no drafts', async () => {
      await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })
      window.localStorage.setItem(KEY, JSON.stringify(['account-1']))

      renderProvider()

      await waitFor(() =>
        expect(screen.getByTestId('probe')).toHaveTextContent('count=0 epoch=1')
      )
      expect(await getDraft('a')).toBeUndefined()
      expect(window.localStorage.getItem(KEY)).toBeNull()
    })

    it('also purges another account that signed out on this device', async () => {
      await saveDraft(draft('a'), { expectedRevision: 0, epoch: 0 })
      window.localStorage.setItem(KEY, JSON.stringify(['account-2']))

      renderProvider()

      await waitFor(() => expect(window.localStorage.getItem(KEY)).toBeNull())
      expect(await getDraft('a')).toBeDefined()
      expect(screen.getByTestId('probe')).toHaveTextContent('count=1 epoch=0')
    })
  })

  describe('an epoch that failed to load', () => {
    // The first open fails, then storage recovers; the real factory serves
    // every open after `failing` is switched off.
    const failFirstOpen = () => {
      const factory = new IDBFactory()
      const state = { failing: true }
      setDraftsIndexedDBFactory({
        open: (name: string, version?: number) => {
          if (!state.failing) return factory.open(name, version)
          const request = {} as IDBOpenDBRequest
          queueMicrotask(() => request.onerror?.(new Event('error')))
          return request
        },
        deleteDatabase: vi.fn()
      } as unknown as IDBFactory)
      return state
    }

    it('is read again when the tab becomes visible', async () => {
      const state = failFirstOpen()
      renderProvider()
      await act(async () => {})
      expect(screen.getByTestId('probe')).toHaveTextContent('epoch=null')

      state.failing = false
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      await waitFor(() =>
        expect(screen.getByTestId('probe')).toHaveTextContent('epoch=0')
      )
    })

    it('is read again on a channel message for this account', async () => {
      const state = failFirstOpen()
      renderProvider()
      await act(async () => {})
      expect(screen.getByTestId('probe')).toHaveTextContent('epoch=null')

      state.failing = false
      await act(async () => {
        postDraftsMessage({
          type: 'changed',
          accountId: 'account-1',
          actorId: 'actor-1',
          draftId: 'd1'
        })
      })

      await waitFor(() =>
        expect(screen.getByTestId('probe')).toHaveTextContent('epoch=0')
      )
    })
  })

  it('never replaces an established epoch, so a stale tab stays refused after a sign-out', async () => {
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('epoch=0')
    )

    // Another tab signs out (the stored epoch moves to 1), signs back in and
    // saves a draft.
    await deleteAccountDrafts('account-1')
    await saveDraft(draft('d1'), { expectedRevision: 0, epoch: 1 })
    await act(async () => {
      postDraftsMessage({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'actor-1',
        draftId: 'd1'
      })
    })

    // The message re-counts right after it would re-read the epoch, so once
    // the new count shows, an epoch read would have landed too.
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('count=1')
    )
    expect(screen.getByTestId('probe')).toHaveTextContent('epoch=0')
  })

  describe('Saved to Drafts note', () => {
    const renderWithNotify = () => {
      let notify: ((id: string, revision: number) => void) | undefined
      const Grab = () => {
        notify = useDrafts()?.notifySavedToDrafts
        return null
      }
      render(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <Grab />
        </DraftsProvider>
      )
      return (id: string) => act(() => notify?.(id, 1))
    }

    it('renders the note once notified', async () => {
      const notify = renderWithNotify()
      await act(async () => {})
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      notify('d1')

      // The note is a lazy chunk, so it appears a tick after the notify.
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Saved to Drafts'
      )
    })

    it('dismiss clears the note', async () => {
      const notify = renderWithNotify()
      await act(async () => {})
      notify('d1')

      fireEvent.click(
        await screen.findByRole('button', { name: 'Dismiss notification' })
      )

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('Discard deletes the stored draft and the count drops to 0', async () => {
      await saveDraft(draft('d1'), { expectedRevision: 0, epoch: 0 })
      let notify: ((id: string, revision: number) => void) | undefined
      const Grab = () => {
        const drafts = useDrafts()
        notify = drafts?.notifySavedToDrafts
        return <p data-testid="count">{`count=${drafts?.count}`}</p>
      }
      render(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <Grab />
        </DraftsProvider>
      )
      await waitFor(() =>
        expect(screen.getByTestId('count')).toHaveTextContent('count=1')
      )
      act(() => notify?.('d1', 1))

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
      })

      await waitFor(() =>
        expect(screen.getByTestId('count')).toHaveTextContent('count=0')
      )
      expect(await getDraft('d1')).toBeUndefined()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    describe('Couldn’t save to Drafts', () => {
      const writeText = vi.fn()
      const renderBoth = async () => {
        let drafts: ReturnType<typeof useDrafts> = null
        const Grab = () => {
          drafts = useDrafts()
          return null
        }
        const view = (accountId: string) => (
          <DraftsProvider accountId={accountId} actorId="actor-1">
            <Grab />
          </DraftsProvider>
        )
        const { rerender } = render(view('account-1'))
        await act(async () => {})
        return {
          switchAccount: async (accountId: string) => {
            rerender(view(accountId))
            await act(async () => {})
          },
          saved: (id: string, revision = 1) =>
            act(() => drafts?.notifySavedToDrafts(id, revision)),
          unsaved: (text: string) =>
            act(() => drafts?.notifyNotSavedToDrafts(text))
        }
      }
      const copy = async () => {
        await act(async () => {
          fireEvent.click(
            await screen.findByRole('button', { name: 'Copy text' })
          )
        })
      }

      beforeEach(() => {
        writeText.mockReset().mockResolvedValue(undefined)
        Object.assign(navigator, { clipboard: { writeText } })
      })

      it('is not replaced by a later Saved note, which waits until it is dismissed', async () => {
        const { saved, unsaved } = await renderBoth()
        unsaved('First thought')
        expect(await screen.findByRole('alert')).toBeInTheDocument()

        saved('d1')
        await act(async () => {})

        await copy()
        expect(writeText).toHaveBeenCalledWith('First thought')
        expect(screen.queryByRole('status')).not.toBeInTheDocument()

        fireEvent.click(
          screen.getByRole('button', { name: 'Dismiss notification' })
        )
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(await screen.findByRole('status')).toHaveTextContent(
          'Saved to Drafts'
        )
      })

      it('a Saved note that waited compares Discard with the kept revision, not the one at its mount', async () => {
        await saveDraft(draft('d1'), { expectedRevision: 0, epoch: 0 })
        const { saved, unsaved } = await renderBoth()
        unsaved('First thought')
        await screen.findByRole('alert')
        saved('d1', 1)

        // Another tab edits the kept draft while the Saved note waits.
        await saveDraft(
          { ...draft('d1'), text: 'edited elsewhere' },
          { expectedRevision: 1, epoch: 0 }
        )
        fireEvent.click(
          screen.getByRole('button', { name: 'Dismiss notification' })
        )
        await screen.findByRole('status')
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
        })

        await waitFor(() =>
          expect(screen.getByRole('status')).toHaveTextContent(
            'Changed in another tab'
          )
        )
        expect((await getDraft('d1'))?.text).toBe('edited elsewhere')
      })

      it('is dropped, with its text, when the account changes', async () => {
        const { unsaved, switchAccount } = await renderBoth()
        unsaved('First thought')
        expect(screen.getByRole('alert')).toBeInTheDocument()

        await switchAccount('account-2')

        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      })

      it('keeps both texts when a second close fails too', async () => {
        const { unsaved } = await renderBoth()
        unsaved('First thought')
        await screen.findByRole('alert')

        unsaved('Second thought')
        await copy()

        expect(screen.getAllByRole('alert')).toHaveLength(1)
        expect(writeText).toHaveBeenCalledWith(
          'First thought\n\nSecond thought'
        )
      })
    })

    it('drops a pending note when the actor changes', async () => {
      let notify: ((id: string, revision: number) => void) | undefined
      const Grab = () => {
        notify = useDrafts()?.notifySavedToDrafts
        return null
      }
      const { rerender } = render(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <Grab />
        </DraftsProvider>
      )
      await act(async () => {})
      act(() => notify?.('d1', 1))
      expect(screen.getByRole('status')).toBeInTheDocument()

      rerender(
        <DraftsProvider accountId="account-1" actorId="actor-2">
          <Grab />
        </DraftsProvider>
      )
      await act(async () => {})

      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  describe('send queue foundation', () => {
    it('useSendQueueStatus is null outside the provider and idle inside it', async () => {
      const Status = () => {
        const status = useSendQueueStatus()
        return (
          <p data-testid="queue">
            {status
              ? `${status.phase} ${status.index}/${status.total} sent=${status.sent} review=${status.needsReview} failed=${status.failed} paused=${status.paused} pause=${typeof status.pause}`
              : 'none'}
          </p>
        )
      }
      const { unmount } = render(<Status />)
      expect(screen.getByTestId('queue')).toHaveTextContent('none')
      unmount()

      render(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <Status />
        </DraftsProvider>
      )
      await act(async () => {})

      expect(screen.getByTestId('queue')).toHaveTextContent(
        'idle 0/0 sent=0 review=0 failed=0 paused=0 pause=function'
      )
    })

    it('exposes a stable requestDrain that does nothing yet', async () => {
      const seen: Array<() => void> = []
      const Grab = () => {
        const drafts = useDrafts()
        if (drafts) seen.push(drafts.requestDrain)
        return null
      }
      render(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <Grab />
        </DraftsProvider>
      )
      await act(async () => {})
      // A context change (signingOut) re-renders the consumer.
      await act(async () => {
        postDraftsMessage({ type: 'signing-out', accountId: 'account-1' })
      })

      expect(seen.length).toBeGreaterThan(1)
      expect(new Set(seen).size).toBe(1)
      expect(() => seen[0]()).not.toThrow()
    })

    it('titles the note for a queued post and a plain one differently', async () => {
      let notify:
        | ((
            id: string,
            revision: number,
            options?: { queued?: boolean }
          ) => void)
        | undefined
      const Grab = () => {
        notify = useDrafts()?.notifySavedToDrafts
        return null
      }
      render(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <Grab />
        </DraftsProvider>
      )
      await act(async () => {})

      act(() => notify?.('d1', 1, { queued: true }))
      expect(await screen.findByRole('status')).toHaveTextContent(
        "Will send when you're back online"
      )

      act(() => notify?.('d2', 1))
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Saved to Drafts')
      )
    })
  })
})
