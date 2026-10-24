/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { useState } from 'react'

import * as draftsModule from '@/lib/client/drafts'
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
import { createDeferred } from '@/lib/testing/deferred'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import { SignOutDialog } from './SignOutDialog'

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: { signOut: vi.fn() }
}))

vi.mock('@/lib/client/offline', () => ({
  clearAllOfflineData: vi.fn().mockResolvedValue(undefined)
}))

type SignOutOptions = {
  fetchOptions?: { onSuccess?: () => unknown; onError?: () => void }
}

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

describe('SignOutDialog', () => {
  let events: string[]
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

  const renderDialog = (
    props: {
      open?: boolean
      onOpenChange?: (open: boolean) => void
      onCloseAutoFocus?: (event: Event) => void
    } = {}
  ) => {
    const onOpenChange = props.onOpenChange ?? vi.fn()
    const open = props.open ?? true
    return render(
      <DraftsProvider accountId="account-1" actorId="actor-1">
        <SignOutDialog
          open={open}
          onOpenChange={onOpenChange}
          onCloseAutoFocus={props.onCloseAutoFocus}
        />
      </DraftsProvider>
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authClient.signOut).mockReset()
    vi.mocked(clearAllOfflineData).mockReset().mockResolvedValue(undefined)
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
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders title, body, Cancel and "Sign out" button with no alert when there are no drafts', async () => {
    renderDialog({ open: true })

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Sign out?')
    expect(dialog).toHaveTextContent(
      'You will be signed out on this device. Other devices stay signed in.'
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('disables the confirm button while countDraftsByState is pending, and enables it once resolved', async () => {
    const deferred = createDeferred<{ waiting: number; drafts: number }>()
    const countSpy = vi
      .spyOn(draftsModule, 'countDraftsByState')
      .mockReturnValue(deferred.promise)

    renderDialog({ open: true })

    const confirmButton = screen.getByRole('button', { name: 'Sign out' })
    expect(confirmButton).toBeDisabled()

    deferred.resolve({ waiting: 0, drafts: 0 })

    await waitFor(() => {
      expect(confirmButton).toBeEnabled()
    })
    countSpy.mockRestore()
  })

  it('renders alert and destructive confirm button when 2 posts are waiting and 1 is a draft', async () => {
    await saveDraft(
      draft({
        id: 'waiting-1',
        queue: { state: 'waiting', queuedAt: 10, attempts: 0 }
      }),
      { expectedRevision: 0, epoch: 0 }
    )
    await saveDraft(
      draft({
        id: 'waiting-2',
        queue: { state: 'couldnt_send', queuedAt: 20, attempts: 1 }
      }),
      { expectedRevision: 0, epoch: 0 }
    )
    await saveDraft(draft({ id: 'draft-1' }), {
      expectedRevision: 0,
      epoch: 0
    })

    renderDialog({ open: true })

    const alert = await screen.findByRole('alert')
    // The first sentence is the Alert's bold title, the rest its body.
    expect(alert).toHaveTextContent(
      '3 posts on this device have not been sent.'
    )
    expect(alert).toHaveTextContent(
      '2 are waiting to send and 1 is a draft. They are saved only on this device, so signing out deletes them and they cannot be restored.'
    )
    const reviewLink = screen.getByRole('link', { name: 'Review drafts' })
    expect(reviewLink).toBeInTheDocument()
    expect(reviewLink).toHaveAttribute('href', '/drafts')
    expect(
      screen.getByRole('button', { name: 'Sign out and delete' })
    ).toBeInTheDocument()
  })

  it('re-reads counts on each opening: shows Alert and "Sign out and delete" when a post is queued while closed', async () => {
    const { rerender } = renderDialog({ open: true })

    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Close the dialog
    rerender(
      <DraftsProvider accountId="account-1" actorId="actor-1">
        <SignOutDialog open={false} onOpenChange={vi.fn()} />
      </DraftsProvider>
    )
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // Queue a post while closed
    await saveDraft(
      draft({
        id: 'waiting-1',
        queue: { state: 'waiting', queuedAt: 10, attempts: 0 }
      }),
      { expectedRevision: 0, epoch: 0 }
    )

    // Reopen dialog
    rerender(
      <DraftsProvider accountId="account-1" actorId="actor-1">
        <SignOutDialog open={true} onOpenChange={vi.fn()} />
      </DraftsProvider>
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('1 post on this device has not been sent.')
    const confirmDelete = await screen.findByRole('button', {
      name: 'Sign out and delete'
    })
    expect(confirmDelete).toBeInTheDocument()
    await waitFor(() => expect(confirmDelete).toBeEnabled())
  })

  it('signs out with zero drafts: broadcasts, clears offline data, calls signOut, and redirects on success', async () => {
    finishSignOut('success')
    renderDialog({ open: true })

    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    fireEvent.click(confirmButton)

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
    expect(events).toEqual(['signing-out', 'signOut'])
    expect(clearAllOfflineData).toHaveBeenCalledTimes(1)
    expect(authClient.signOut).toHaveBeenCalledTimes(1)
  })

  it('signs out successfully: calls signOut, broadcasts, clears offline data, purges drafts, increments epoch, and redirects', async () => {
    await saveDraft(draft({ id: 'draft-1' }), {
      expectedRevision: 0,
      epoch: 0
    })
    finishSignOut('success')
    renderDialog({ open: true })

    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out and delete'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    fireEvent.click(confirmButton)

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
    expect(events).toEqual(['signing-out', 'signOut'])
    expect(clearAllOfflineData).toHaveBeenCalledTimes(1)
    expect(await countDrafts({ accountId: 'account-1' })).toBe(0)
    expect(await getAccountEpoch('account-1')).toBe(1)
  })

  it('redirects only once the drafts are deleted', async () => {
    await saveDraft(draft({ id: 'draft-1' }), {
      expectedRevision: 0,
      epoch: 0
    })
    finishSignOut('success')
    let pendingAtRedirect: string | null | undefined
    assign.mockImplementation(() => {
      pendingAtRedirect = window.localStorage.getItem(
        'activities-drafts-pending-purge'
      )
    })
    renderDialog({ open: true })

    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out and delete'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    fireEvent.click(confirmButton)

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
    expect(pendingAtRedirect).toBeNull()
  })

  it('purges drafts only after signOut succeeds on the server', async () => {
    await saveDraft(draft({ id: 'draft-1' }), {
      expectedRevision: 0,
      epoch: 0
    })
    let triggerSuccess: (() => Promise<unknown>) | undefined
    vi.mocked(authClient.signOut).mockImplementation((async (
      options: SignOutOptions
    ) => {
      events.push('signOut')
      triggerSuccess = async () => options.fetchOptions?.onSuccess?.()
    }) as unknown as typeof authClient.signOut)

    const purgeSpy = vi.spyOn(draftsModule, 'purgeAccountDrafts')

    renderDialog({ open: true })
    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out and delete'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    fireEvent.click(confirmButton)

    // While signOut is in flight before onSuccess is called, purgeAccountDrafts is not called
    await waitFor(() => expect(authClient.signOut).toHaveBeenCalled())
    expect(purgeSpy).not.toHaveBeenCalled()

    // Call onSuccess after server confirms
    await triggerSuccess?.()

    await waitFor(() => expect(purgeSpy).toHaveBeenCalledWith('account-1'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
    purgeSpy.mockRestore()
  })

  it('leaves the pending-purge marker in localStorage when drafts chunk fails to load at purge time while redirecting', async () => {
    await saveDraft(draft({ id: 'draft-1' }), {
      expectedRevision: 0,
      epoch: 0
    })
    finishSignOut('success')
    renderDialog({ open: true })

    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out and delete'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())

    vi.doMock('@/lib/client/drafts', () => {
      throw new Error('Loading chunk failed')
    })
    try {
      fireEvent.click(confirmButton)
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
    } finally {
      vi.doUnmock('@/lib/client/drafts')
    }

    expect(
      JSON.parse(
        window.localStorage.getItem('activities-drafts-pending-purge') ?? '[]'
      )
    ).toEqual(['account-1'])
    expect(events).toEqual(['signing-out', 'signOut'])
  })

  it('keeps the dialog open, shows error Alert, retains drafts, and broadcasts sign-out-cancelled on failure', async () => {
    await saveDraft(draft({ id: 'draft-1' }), {
      expectedRevision: 0,
      epoch: 0
    })
    finishSignOut('error')
    renderDialog({ open: true })

    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out and delete'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    fireEvent.click(confirmButton)

    await waitFor(() =>
      expect(
        screen.getByText('Sign out failed. Please try again.')
      ).toBeInTheDocument()
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(events).toEqual(['signing-out', 'signOut', 'sign-out-cancelled'])
    expect(await countDrafts({ accountId: 'account-1' })).toBe(1)
    expect(await getAccountEpoch('account-1')).toBe(0)
    expect(assign).not.toHaveBeenCalled()
  })

  it('keeps the dialog open, shows error Alert, retains drafts, and broadcasts sign-out-cancelled on network reject', async () => {
    await saveDraft(draft({ id: 'draft-1' }), {
      expectedRevision: 0,
      epoch: 0
    })
    vi.mocked(authClient.signOut).mockImplementation((async () => {
      events.push('signOut')
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof authClient.signOut)

    renderDialog({ open: true })

    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out and delete'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    fireEvent.click(confirmButton)

    await waitFor(() =>
      expect(
        screen.getByText('Sign out failed. Please try again.')
      ).toBeInTheDocument()
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(events).toEqual(['signing-out', 'signOut', 'sign-out-cancelled'])
    expect(await countDrafts({ accountId: 'account-1' })).toBe(1)
    expect(await getAccountEpoch('account-1')).toBe(0)
    expect(assign).not.toHaveBeenCalled()
  })

  it('leaves the purge marked pending when deletion fails after sign-out, finished by next provider mount', async () => {
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
    await saveDraft(draft({ id: 'draft-1' }), {
      expectedRevision: 0,
      epoch: 0
    })
    finishSignOut('success')

    const view = renderDialog({ open: true })
    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out and delete'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())

    // Storage breaks after dialog counts drafts, before purge
    state.failing = true
    resetDraftsDbForTesting()
    fireEvent.click(confirmButton)

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
    expect(
      JSON.parse(
        window.localStorage.getItem('activities-drafts-pending-purge') ?? '[]'
      )
    ).toEqual(['account-1'])

    // Storage recovers on next mount
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
    ).toBeNull()
  })

  it('treats unavailable storage as no drafts and signs out cleanly', async () => {
    setDraftsIndexedDBFactory(null)
    finishSignOut('success')
    renderDialog({ open: true })

    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(confirmButton)

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
    expect(events).toEqual(['signing-out', 'signOut'])
  })

  it('calls onOpenChange(false) when Cancel button is clicked', async () => {
    const onOpenChange = vi.fn()
    renderDialog({ open: true, onOpenChange })

    const cancelButton = await screen.findByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButton)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('calls onCloseAutoFocus when the dialog closes', async () => {
    const onCloseAutoFocus = vi.fn()
    function ControlledDialog() {
      const [open, setOpen] = useState(true)
      return (
        <DraftsProvider accountId="account-1" actorId="actor-1">
          <SignOutDialog
            open={open}
            onOpenChange={setOpen}
            onCloseAutoFocus={onCloseAutoFocus}
          />
        </DraftsProvider>
      )
    }
    render(<ControlledDialog />)

    const cancelButton = await screen.findByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButton)

    await waitFor(() => {
      expect(onCloseAutoFocus).toHaveBeenCalled()
    })
  })

  it('disables buttons and prevents closing while signing out', async () => {
    let resolveSignOut: () => void = () => {}
    vi.mocked(authClient.signOut).mockImplementation((() => {
      events.push('signOut')
      return new Promise<void>((resolve) => {
        resolveSignOut = resolve
      })
    }) as unknown as typeof authClient.signOut)

    const onOpenChange = vi.fn()
    renderDialog({ open: true, onOpenChange })

    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Signing out…' })
      ).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    // Press Escape on the dialog while signing out: closing is blocked
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    resolveSignOut()
  })

  it('ignores a second click on the confirm button while sign out is in flight', async () => {
    let resolveSignOut: () => void = () => {}
    vi.mocked(authClient.signOut).mockImplementation((() => {
      events.push('signOut')
      return new Promise<void>((resolve) => {
        resolveSignOut = resolve
      })
    }) as unknown as typeof authClient.signOut)

    renderDialog({ open: true })
    const confirmButton = await screen.findByRole('button', {
      name: 'Sign out'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())

    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    await waitFor(() => expect(authClient.signOut).toHaveBeenCalledTimes(1))
    expect(authClient.signOut).toHaveBeenCalledTimes(1)
    resolveSignOut()
  })

  it('disables "Review drafts" link with aria-disabled="true" and ignores clicks while signing out', async () => {
    await saveDraft(draft({ id: 'draft-1' }), {
      expectedRevision: 0,
      epoch: 0
    })
    let resolveSignOut: () => void = () => {}
    vi.mocked(authClient.signOut).mockImplementation((() => {
      events.push('signOut')
      return new Promise<void>((resolve) => {
        resolveSignOut = resolve
      })
    }) as unknown as typeof authClient.signOut)

    const onOpenChange = vi.fn()
    renderDialog({ open: true, onOpenChange })

    const reviewLink = await screen.findByRole('link', {
      name: 'Review drafts'
    })
    expect(reviewLink).not.toHaveAttribute('aria-disabled')

    const confirmButton = screen.getByRole('button', {
      name: 'Sign out and delete'
    })
    await waitFor(() => expect(confirmButton).toBeEnabled())
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(reviewLink).toHaveAttribute('aria-disabled', 'true')
    })

    fireEvent.click(reviewLink)
    expect(onOpenChange).not.toHaveBeenCalled()

    resolveSignOut()
  })
})
