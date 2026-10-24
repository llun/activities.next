/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'

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
    } = {}
  ) => {
    const onOpenChange = props.onOpenChange ?? vi.fn()
    const open = props.open ?? true
    return render(
      <DraftsProvider accountId="account-1" actorId="actor-1">
        <SignOutDialog open={open} onOpenChange={onOpenChange} />
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
    fireEvent.click(confirmButton)

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/signin'))
    expect(events).toEqual(['signing-out', 'signOut'])
    expect(clearAllOfflineData).toHaveBeenCalledTimes(1)
    expect(await countDrafts({ accountId: 'account-1' })).toBe(0)
    expect(await getAccountEpoch('account-1')).toBe(1)
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
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Signing out…' })
      ).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    // Trying to close via onOpenChange while signing out is blocked
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButton)
    expect(onOpenChange).not.toHaveBeenCalled()

    resolveSignOut()
  })
})
