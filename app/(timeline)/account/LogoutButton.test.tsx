/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import type { Mock } from 'vitest'

import {
  type DraftRecord,
  countDrafts,
  getAccountEpoch,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory,
  subscribeDraftsMessages
} from '@/lib/client/drafts'
import { clearAllOfflineData } from '@/lib/client/offline'
import { DraftsProvider } from '@/lib/components/drafts/DraftsProvider'
import { authClient } from '@/lib/services/auth/auth-client'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import { LogoutButton } from './LogoutButton'

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: { signOut: vi.fn() }
}))

vi.mock('@/lib/client/offline', () => ({
  clearAllOfflineData: vi.fn().mockResolvedValue(undefined)
}))

describe('LogoutButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authClient.signOut).mockReset()
    vi.mocked(clearAllOfflineData).mockReset().mockResolvedValue(undefined)
  })

  it('is described by the hint of the row it sits in', () => {
    render(
      <>
        <p id="hint">You can sign in again at any time.</p>
        <LogoutButton describedBy="hint" onError={vi.fn()} />
      </>
    )

    expect(
      screen.getByRole('button', { name: 'Sign out' })
    ).toHaveAccessibleDescription('You can sign in again at any time.')
  })

  it('is labelled by the label of the row it sits in', () => {
    render(
      <>
        <span id="label">Sign out of this device</span>
        <LogoutButton labelledBy="label" onError={vi.fn()} />
      </>
    )

    expect(
      screen.getByRole('button', { name: 'Sign out of this device' })
    ).toHaveAttribute('aria-labelledby', 'label')
  })

  it('reports the error when sign out fails', async () => {
    vi.mocked(authClient.signOut).mockImplementation(((options: {
      fetchOptions?: { onError?: () => void }
    }) => {
      options.fetchOptions?.onError?.()
    }) as unknown as typeof authClient.signOut)
    const onError = vi.fn()
    render(<LogoutButton onError={onError} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(onError).toHaveBeenLastCalledWith(
        'Sign out failed. Please try again.'
      )
    })
    expect(onError).toHaveBeenNthCalledWith(1, null)
  })

  it('clears all offline data when logout button is clicked', async () => {
    render(<LogoutButton onError={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => {
      expect(clearAllOfflineData).toHaveBeenCalledTimes(1)
    })
  })

  describe('with drafts on this device', () => {
    type SignOutOptions = {
      fetchOptions?: { onSuccess?: () => unknown; onError?: () => void }
    }

    const draft = (id: string, accountId = 'account-1'): DraftRecord => ({
      id,
      accountId,
      actorId: `actor-of-${id}`,
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

    let events: string[]
    let onError: Mock<(message: string | null) => void>
    let unsubscribe: () => void
    const assign = vi.fn()

    const finishSignOut = (outcome: 'success' | 'error') =>
      vi.mocked(authClient.signOut).mockImplementation((async (
        options: SignOutOptions
      ) => {
        events.push('signOut')
        if (outcome === 'success') await options.fetchOptions?.onSuccess?.()
        else options.fetchOptions?.onError?.()
      }) as unknown as typeof authClient.signOut)

    const renderLogout = () => {
      onError = vi.fn<(message: string | null) => void>()
      render(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <LogoutButton onError={onError} />
        </DraftsProvider>
      )
    }

    const save = async (...ids: string[]) => {
      for (const id of ids) {
        await saveDraft(draft(id), { expectedRevision: 0, epoch: 0 })
      }
    }

    beforeEach(() => {
      events = []
      installFakeBroadcastChannel()
      setDraftsIndexedDBFactory(new IDBFactory())
      unsubscribe = subscribeDraftsMessages((message) => {
        if (message.type !== 'changed') events.push(message.type)
      })
      vi.stubGlobal('location', {
        set href(value: string) {
          assign(value)
        }
      })
      assign.mockReset()
    })

    afterEach(() => {
      window.localStorage.clear()
      unsubscribe()
      resetDraftsChannelForTesting()
      setDraftsIndexedDBFactory(null)
      resetDraftsDbForTesting()
      vi.unstubAllGlobals()
    })

    it('with no drafts, signs out without a dialog and broadcasts first', async () => {
      finishSignOut('success')
      renderLogout()

      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(events).toEqual(['signing-out', 'signOut'])
      expect(await getAccountEpoch('account-1')).toBe(1)
    })

    it('asks before deleting unsent posts, counting every actor of the account', async () => {
      await save('a', 'b')
      await saveDraft(draft('other', 'account-2'), {
        expectedRevision: 0,
        epoch: 0
      })
      renderLogout()

      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveAccessibleName('Delete 2 unsent posts?')
      expect(dialog).toHaveTextContent(
        'These posts are saved only on this device. Signing out deletes them.'
      )
      expect(
        screen.getByRole('button', { name: 'Keep me signed in' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Sign out and delete' })
      ).toBeInTheDocument()
      expect(authClient.signOut).not.toHaveBeenCalled()
      expect(clearAllOfflineData).not.toHaveBeenCalled()
    })

    it('uses the singular for one unsent post', async () => {
      await save('a')
      renderLogout()

      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

      expect(await screen.findByRole('dialog')).toHaveAccessibleName(
        'Delete 1 unsent post?'
      )
    })

    it('Keep me signed in closes the dialog and signs nothing out', async () => {
      await save('a')
      renderLogout()
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

      fireEvent.click(
        await screen.findByRole('button', { name: 'Keep me signed in' })
      )

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
      expect(authClient.signOut).not.toHaveBeenCalled()
      expect(events).toEqual([])
      expect(await countDrafts({ accountId: 'account-1' })).toBe(1)
    })

    it('Sign out and delete broadcasts before signOut, then deletes the drafts only after it succeeds', async () => {
      await save('a', 'b')
      finishSignOut('success')
      renderLogout()
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

      fireEvent.click(
        await screen.findByRole('button', { name: 'Sign out and delete' })
      )

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
      expect(events).toEqual(['signing-out', 'signOut'])
      expect(await countDrafts({ accountId: 'account-1' })).toBe(0)
      expect(await getAccountEpoch('account-1')).toBe(1)
    })

    it('redirects only once the drafts are deleted', async () => {
      await save('a')
      finishSignOut('success')
      // What the redirect would leave behind: a purge still marked pending
      // means it left before the deletion finished.
      let pendingAtRedirect: string | null | undefined
      assign.mockImplementation(() => {
        pendingAtRedirect = window.localStorage.getItem(
          'activities-drafts-pending-purge'
        )
      })
      renderLogout()
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

      fireEvent.click(
        await screen.findByRole('button', { name: 'Sign out and delete' })
      )

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
      expect(pendingAtRedirect).toBeNull()
    })

    it('still redirects, with the purge marked pending, when the drafts code fails to load', async () => {
      finishSignOut('success')
      renderLogout()
      // The account is resolved; from here every load of the drafts code fails
      // (the count, then the purge).
      vi.doMock('@/lib/client/drafts', () => {
        throw new Error('Loading chunk failed')
      })
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

        await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
      } finally {
        vi.doUnmock('@/lib/client/drafts')
      }
      expect(
        JSON.parse(
          window.localStorage.getItem('activities-drafts-pending-purge') ?? '[]'
        )
      ).toEqual(['account-1'])
      expect(onError).not.toHaveBeenCalledWith(
        'Sign out failed. Please try again.'
      )
      expect(events).toEqual(['signing-out', 'signOut'])
    })

    it('a failed sign-out keeps the drafts, cancels the broadcast and reports the error', async () => {
      await save('a')
      finishSignOut('error')
      renderLogout()
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

      fireEvent.click(
        await screen.findByRole('button', { name: 'Sign out and delete' })
      )

      await waitFor(() =>
        expect(onError).toHaveBeenLastCalledWith(
          'Sign out failed. Please try again.'
        )
      )
      expect(events).toEqual(['signing-out', 'signOut', 'sign-out-cancelled'])
      expect(await countDrafts({ accountId: 'account-1' })).toBe(1)
      expect(await getAccountEpoch('account-1')).toBe(0)
      expect(assign).not.toHaveBeenCalled()
    })

    it('a sign-out that rejects on a network failure cancels the broadcast and keeps the drafts', async () => {
      await save('a')
      vi.mocked(authClient.signOut).mockImplementation((async () => {
        events.push('signOut')
        throw new TypeError('Failed to fetch')
      }) as unknown as typeof authClient.signOut)
      renderLogout()
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

      fireEvent.click(
        await screen.findByRole('button', { name: 'Sign out and delete' })
      )

      await waitFor(() =>
        expect(onError).toHaveBeenLastCalledWith(
          'Sign out failed. Please try again.'
        )
      )
      expect(events).toEqual(['signing-out', 'signOut', 'sign-out-cancelled'])
      expect(await countDrafts({ accountId: 'account-1' })).toBe(1)
      expect(await getAccountEpoch('account-1')).toBe(0)
      expect(assign).not.toHaveBeenCalled()
    })

    it('a deletion that fails after sign-out stays pending, and the next provider mount finishes it', async () => {
      const factory = new IDBFactory()
      const state = { failing: false }
      const flaky = {
        open: (name: string, version?: number) => {
          if (!state.failing) return factory.open(name, version)
          const request = {} as IDBOpenDBRequest
          queueMicrotask(() => request.onerror?.(new Event('error')))
          return request
        },
        deleteDatabase: vi.fn()
      } as unknown as IDBFactory
      setDraftsIndexedDBFactory(flaky)
      resetDraftsDbForTesting()
      await save('a')
      finishSignOut('success')
      const view = render(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <LogoutButton onError={vi.fn()} />
        </DraftsProvider>
      )
      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
      fireEvent.click(
        await screen.findByRole('button', { name: 'Sign out and delete' })
      )
      // Storage breaks after the dialog counted the drafts, before the delete.
      state.failing = true
      resetDraftsDbForTesting()

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
      expect(
        JSON.parse(
          window.localStorage.getItem('activities-drafts-pending-purge') ?? '[]'
        )
      ).toEqual(['account-1'])

      // Storage recovers and the app loads again: the purge finishes first.
      state.failing = false
      resetDraftsDbForTesting()
      view.unmount()
      expect(await countDrafts({ accountId: 'account-1' })).toBe(1)
      render(
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <p />
        </DraftsProvider>
      )

      await waitFor(async () =>
        expect(await countDrafts({ accountId: 'account-1' })).toBe(0)
      )
      expect(
        window.localStorage.getItem('activities-drafts-pending-purge')
      ).toBe(null)
    })

    it('treats unavailable storage as no drafts: no dialog, and sign-out still completes', async () => {
      setDraftsIndexedDBFactory(null)
      finishSignOut('success')
      renderLogout()

      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

      await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
