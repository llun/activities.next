/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

import {
  cancelHostedBlueskyMoveOut,
  copyHostedBlueskyMoveOutBlobs,
  copyHostedBlueskyMoveOutPreferences,
  createHostedBlueskyAccount,
  deleteHostedBlueskyAccount,
  finishHostedBlueskyMoveOut,
  getHostedBlueskyMoveOut,
  sendHostedBlueskyMoveOutRepo,
  startHostedBlueskyMoveOut,
  updateHostedBlueskyAccount
} from '@/lib/client'
import type {
  HostedBlueskyAccountState,
  HostedBlueskyRepoSummary
} from '@/lib/utils/blueskyHosted'

import { HostedBlueskyForm } from './HostedBlueskyForm'

vi.mock('@/lib/client', () => ({
  cancelHostedBlueskyMoveOut: vi.fn(),
  copyHostedBlueskyMoveOutBlobs: vi.fn(),
  copyHostedBlueskyMoveOutPreferences: vi.fn(),
  createHostedBlueskyAccount: vi.fn(),
  deleteHostedBlueskyAccount: vi.fn(),
  finishHostedBlueskyMoveOut: vi.fn(),
  getHostedBlueskyMoveOut: vi.fn(),
  sendHostedBlueskyMoveOutRepo: vi.fn(),
  startHostedBlueskyMoveOut: vi.fn(),
  updateHostedBlueskyAccount: vi.fn()
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const activeRepo: HostedBlueskyRepoSummary = {
  did: 'did:plc:abc123',
  handle: 'alice.pds.example.com',
  status: 'active',
  recoveryKeyDid: null
}

const state = (
  overrides: Partial<HostedBlueskyAccountState> = {}
): HostedBlueskyAccountState => ({
  available: true,
  pdsHostname: 'pds.example.com',
  rotationKeyConfigured: true,
  repo: null,
  handleChoices: [
    { handle: 'alice.pds.example.com', kind: 'pds' },
    { handle: 'alice.example.com', kind: 'instance' }
  ],
  customHandleAllowed: false,
  movedTo: null,
  moveOut: null,
  ...overrides
})

const show = (initialState: HostedBlueskyAccountState, linked = false) =>
  render(<HostedBlueskyForm initialState={initialState} linked={linked} />)

describe('HostedBlueskyForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getHostedBlueskyMoveOut).mockResolvedValue({
      progress: null,
      state: state()
    })
    vi.mocked(sendHostedBlueskyMoveOutRepo).mockResolvedValue({
      importedRev: 'rev1',
      bytes: 1
    })
    vi.mocked(copyHostedBlueskyMoveOutBlobs).mockResolvedValue({
      copied: 0,
      failed: [],
      cursor: null,
      done: true
    })
    vi.mocked(copyHostedBlueskyMoveOutPreferences).mockResolvedValue({
      count: 0
    })
  })

  it('asks an admin for the rotation key when the server has none', () => {
    show(state({ rotationKeyConfigured: false }))
    expect(
      screen.getByText(
        'This server isn’t ready to host Bluesky accounts yet. Ask an admin to set its rotation key.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create Bluesky account' })
    ).not.toBeInTheDocument()
  })

  it('asks to unlink the outside account first', () => {
    show(state(), true)
    expect(
      screen.getByText(
        'Your account above is on another server. Unlink it first to create one here; moving it here comes later.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create Bluesky account' })
    ).not.toBeInTheDocument()
  })

  it('creates an account with the first offered handle', async () => {
    vi.mocked(createHostedBlueskyAccount).mockResolvedValue(
      state({ repo: activeRepo })
    )
    show(state())
    expect(
      screen.getByRole('radio', { name: '@alice.pds.example.com' })
    ).toBeChecked()
    fireEvent.click(
      screen.getByRole('button', { name: 'Create Bluesky account' })
    )
    await waitFor(() =>
      expect(createHostedBlueskyAccount).toHaveBeenCalledWith(
        'alice.pds.example.com'
      )
    )
    expect(await screen.findByText('Active')).toBeInTheDocument()
  })

  it('shows the server’s message when creating fails', async () => {
    vi.mocked(createHostedBlueskyAccount).mockRejectedValue(
      new Error('This profile already has a hosted Bluesky account.')
    )
    show(state())
    fireEvent.click(
      screen.getByRole('button', { name: 'Create Bluesky account' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This profile already has a hosted Bluesky account.'
    )
  })

  it('shows the active account’s status, handle and actions', () => {
    show(state({ repo: activeRepo }))
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByTitle('did:plc:abc123')).toHaveTextContent(
      'did:plc:abc123'
    )
    expect(screen.getByText('@alice.pds.example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
    expect(screen.getByLabelText('Recovery key')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete account' })
    ).toBeInTheDocument()
  })

  it('turns the account off', async () => {
    vi.mocked(updateHostedBlueskyAccount).mockResolvedValue(
      state({ repo: { ...activeRepo, status: 'deactivated' } })
    )
    show(state({ repo: activeRepo }))
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await waitFor(() =>
      expect(updateHostedBlueskyAccount).toHaveBeenCalledWith({ active: false })
    )
    expect(await screen.findByText('Off')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
    // The success message is an Alert outside the card's frame.
    const message = screen.getByRole('status')
    expect(message).toHaveTextContent('Bluesky account turned off.')
    expect(message.closest('[data-slot="frame"]')).toBeNull()
  })

  it('turns the account back on', async () => {
    vi.mocked(updateHostedBlueskyAccount).mockResolvedValue(
      state({ repo: activeRepo })
    )
    show(state({ repo: { ...activeRepo, status: 'deactivated' } }))
    expect(screen.getByText('Off')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await waitFor(() =>
      expect(updateHostedBlueskyAccount).toHaveBeenCalledWith({ active: true })
    )
    expect(await screen.findByText('Active')).toBeInTheDocument()
  })

  it('changes the handle', async () => {
    vi.mocked(updateHostedBlueskyAccount).mockResolvedValue(
      state({ repo: { ...activeRepo, handle: 'alice.example.com' } })
    )
    show(state({ repo: activeRepo, customHandleAllowed: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('radiogroup', { name: 'Handle' })).toHaveAttribute(
      'aria-labelledby'
    )
    const input = screen.getByLabelText('New handle')
    expect(input).toHaveValue('alice.pds.example.com')
    fireEvent.change(input, { target: { value: 'alice.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateHostedBlueskyAccount).toHaveBeenCalledWith({
        handle: 'alice.example.com'
      })
    )
    expect(await screen.findByText('@alice.example.com')).toBeInTheDocument()
  })

  const confirmWithPassword = (button: string, password: string) => {
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: password }
    })
    fireEvent.click(within(dialog).getByRole('button', { name: button }))
    return dialog
  }

  it('adds a recovery key after the current password', async () => {
    vi.mocked(updateHostedBlueskyAccount).mockResolvedValue(
      state({ repo: { ...activeRepo, recoveryKeyDid: 'did:key:zRecovery' } })
    )
    show(state({ repo: activeRepo }))
    fireEvent.change(screen.getByLabelText('Recovery key'), {
      target: { value: 'did:key:zRecovery' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(updateHostedBlueskyAccount).not.toHaveBeenCalled()
    confirmWithPassword('Add recovery key', 'hunter2')
    await waitFor(() =>
      expect(updateHostedBlueskyAccount).toHaveBeenCalledWith({
        recoveryKeyDid: 'did:key:zRecovery',
        currentPassword: 'hunter2'
      })
    )
    expect(await screen.findByText('did:key:zRecovery')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('removes the recovery key after the current password', async () => {
    vi.mocked(updateHostedBlueskyAccount).mockResolvedValue(
      state({ repo: activeRepo })
    )
    show(
      state({ repo: { ...activeRepo, recoveryKeyDid: 'did:key:zRecovery' } })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(updateHostedBlueskyAccount).not.toHaveBeenCalled()
    confirmWithPassword('Remove recovery key', 'hunter2')
    await waitFor(() =>
      expect(updateHostedBlueskyAccount).toHaveBeenCalledWith({
        recoveryKeyDid: null,
        currentPassword: 'hunter2'
      })
    )
    expect(await screen.findByLabelText('Recovery key')).toBeInTheDocument()
  })

  it('shows a wrong password in the recovery key dialog', async () => {
    vi.mocked(updateHostedBlueskyAccount).mockRejectedValue(
      new Error('Current password is incorrect')
    )
    show(
      state({ repo: { ...activeRepo, recoveryKeyDid: 'did:key:zRecovery' } })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = confirmWithPassword('Remove recovery key', 'wrong')
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Current password is incorrect'
    )
    expect(screen.getByText('did:key:zRecovery')).toBeInTheDocument()
  })

  it('deletes the account after typing its handle', async () => {
    vi.mocked(deleteHostedBlueskyAccount).mockResolvedValue(state())
    show(state({ repo: activeRepo }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Handle'), {
      target: { value: 'alice.pds.example.com' }
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete account' })
    )
    await waitFor(() =>
      expect(deleteHostedBlueskyAccount).toHaveBeenCalledWith(
        'alice.pds.example.com'
      )
    )
    expect(
      await screen.findByRole('button', { name: 'Create Bluesky account' })
    ).toBeInTheDocument()
  })

  it('shows the server’s message when deleting fails', async () => {
    vi.mocked(deleteHostedBlueskyAccount).mockRejectedValue(
      new Error('Type the account’s current handle to confirm deleting it.')
    )
    show(state({ repo: activeRepo }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Handle'), {
      target: { value: 'wrong.example.com' }
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete account' })
    )
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Type the account’s current handle to confirm deleting it.'
    )
  })

  it('shows a suspended account with no actions', () => {
    show(state({ repo: { ...activeRepo, status: 'takendown' } }))
    expect(screen.getByText('Suspended')).toBeInTheDocument()
    expect(
      screen.getByText(
        'An admin has suspended this profile, so its Bluesky account is off.'
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Turn off' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Turn on' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Delete account' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Change' })
    ).not.toBeInTheDocument()
  })

  const expectNoteOutsideFrame = (text: string) => {
    const note = screen.getByText(text)
    expect(note.closest('[role="status"]')).not.toBeNull()
    expect(note.closest('[data-slot="frame"]')).toBeNull()
  }

  it('shows the not-ready and linked-elsewhere notes as alerts outside the frame', () => {
    const { unmount } = show(state({ rotationKeyConfigured: false }))
    expectNoteOutsideFrame(
      'This server isn’t ready to host Bluesky accounts yet. Ask an admin to set its rotation key.'
    )
    unmount()
    show(state(), true)
    expectNoteOutsideFrame(
      'Your account above is on another server. Unlink it first to create one here; moving it here comes later.'
    )
  })

  it('explains when no handle can be offered instead of offering Create', () => {
    show(state({ handleChoices: [] }))
    expectNoteOutsideFrame(
      'Your username can’t be used as a Bluesky handle, so this server can’t offer you one yet.'
    )
    expect(
      screen.queryByRole('button', { name: 'Create Bluesky account' })
    ).not.toBeInTheDocument()
  })

  it('offers Turn off, Move and Delete when the server no longer offers accounts', () => {
    show(state({ available: false, repo: activeRepo }))
    expectNoteOutsideFrame(
      'This server no longer offers Bluesky accounts to this profile. You can still turn yours off, move it to another server, or delete it.'
    )
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Move to another server' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete account' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Change' })
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Recovery key')).not.toBeInTheDocument()
  })

  it('does not offer Turn on when the server no longer offers accounts', () => {
    show(
      state({
        available: false,
        repo: { ...activeRepo, status: 'deactivated' }
      })
    )
    expect(
      screen.queryByRole('button', { name: 'Turn on' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Delete account' })
    ).toBeInTheDocument()
  })

  it('does not offer Create after deleting an account the server no longer offers', async () => {
    vi.mocked(deleteHostedBlueskyAccount).mockResolvedValue(
      state({ available: false })
    )
    show(state({ available: false, repo: activeRepo }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Handle'), {
      target: { value: 'alice.pds.example.com' }
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete account' })
    )
    expect(
      await screen.findByText('Bluesky account deleted.')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create Bluesky account' })
    ).not.toBeInTheDocument()
  })

  it('forgets an open handle edit and a typed recovery key after deleting', async () => {
    vi.mocked(deleteHostedBlueskyAccount).mockResolvedValue(state())
    vi.mocked(createHostedBlueskyAccount).mockResolvedValue(
      state({ repo: activeRepo, customHandleAllowed: true })
    )
    show(state({ repo: activeRepo, customHandleAllowed: true }))
    fireEvent.change(screen.getByLabelText('Recovery key'), {
      target: { value: 'did:key:zTyped' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Handle'), {
      target: { value: 'alice.pds.example.com' }
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete account' })
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create Bluesky account' })
    )

    expect(
      await screen.findByRole('button', { name: 'Change' })
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('New handle')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Recovery key')).toHaveValue('')
  })

  const moveOut = (
    stage: 'started' | 'switched' = 'started'
  ): NonNullable<HostedBlueskyAccountState['moveOut']> => ({
    pdsUrl: 'https://bsky.social',
    handle: 'alex.bsky.social',
    stage
  })

  it('shows a failed start above the move form and scrolls it into view', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    vi.mocked(startHostedBlueskyMoveOut).mockRejectedValue(
      new Error('Could not reach the destination server.')
    )
    show(state({ repo: activeRepo }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Move to another server' })
    )
    for (const [label, value] of [
      ['New server', 'https://bsky.social'],
      ['Handle there', 'alex.bsky.social'],
      ['Email', 'alex@example.com'],
      ['Password there', 'hunter2'],
      ['Your password here', 'local-secret']
    ]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
    const start = screen.getByRole('button', { name: 'Start the move' })
    fireEvent.click(start)
    const alert = await screen.findByText(
      'Could not reach the destination server.'
    )
    // Above the form's own button, where the owner is looking.
    expect(
      alert.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('posts the start body and never renders the new password', async () => {
    vi.mocked(startHostedBlueskyMoveOut).mockResolvedValue({
      moveOut: moveOut(),
      state: state({ repo: activeRepo, moveOut: moveOut() })
    })
    show(state({ repo: activeRepo }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Move to another server' })
    )
    fireEvent.change(screen.getByLabelText('New server'), {
      target: { value: 'https://bsky.social' }
    })
    fireEvent.change(screen.getByLabelText('Handle there'), {
      target: { value: 'alex.bsky.social' }
    })
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'alex@example.com' }
    })
    fireEvent.change(screen.getByLabelText('Password there'), {
      target: { value: 'hunter2' }
    })
    fireEvent.change(screen.getByLabelText('Invite code'), {
      target: { value: 'code' }
    })
    expect(
      screen.getByRole('button', { name: 'Start the move' })
    ).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Your password here'), {
      target: { value: 'local-secret' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start the move' }))
    await waitFor(() =>
      expect(startHostedBlueskyMoveOut).toHaveBeenCalledWith({
        pdsUrl: 'https://bsky.social',
        handle: 'alex.bsky.social',
        email: 'alex@example.com',
        password: 'hunter2',
        currentPassword: 'local-secret',
        inviteCode: 'code'
      })
    )
    expect(screen.queryByText('hunter2')).not.toBeInTheDocument()
  })

  it('copies the repo, every blob batch and the preferences in order', async () => {
    vi.mocked(copyHostedBlueskyMoveOutBlobs)
      .mockResolvedValueOnce({
        copied: 2,
        failed: [],
        cursor: 'c1',
        done: false
      })
      .mockResolvedValueOnce({
        copied: 1,
        failed: [],
        cursor: null,
        done: true
      })
    show(state({ repo: activeRepo, moveOut: moveOut() }))
    await waitFor(() =>
      expect(copyHostedBlueskyMoveOutPreferences).toHaveBeenCalled()
    )
    expect(sendHostedBlueskyMoveOutRepo).toHaveBeenCalledTimes(1)
    expect(copyHostedBlueskyMoveOutBlobs).toHaveBeenNthCalledWith(1, {
      limit: 100
    })
    expect(copyHostedBlueskyMoveOutBlobs).toHaveBeenNthCalledWith(2, {
      limit: 100,
      cursor: 'c1'
    })
    // The steps run in order: repo, then every blob page, then preferences.
    const repoOrder = vi.mocked(sendHostedBlueskyMoveOutRepo).mock
      .invocationCallOrder[0]
    const blobOrders = vi.mocked(copyHostedBlueskyMoveOutBlobs).mock
      .invocationCallOrder
    const preferencesOrder = vi.mocked(copyHostedBlueskyMoveOutPreferences).mock
      .invocationCallOrder[0]
    expect(repoOrder).toBeLessThan(blobOrders[0])
    expect(blobOrders[0]).toBeLessThan(blobOrders[1])
    expect(blobOrders[1]).toBeLessThan(preferencesOrder)
    expect(
      await screen.findByText('Images and videos: 3 copied')
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Switch to bsky.social' })
    ).toBeInTheDocument()
  })

  it('shows a failed step and resumes from it with Try again', async () => {
    vi.mocked(copyHostedBlueskyMoveOutBlobs)
      .mockRejectedValueOnce(new Error('Destination server is down.'))
      .mockResolvedValueOnce({
        copied: 0,
        failed: [],
        cursor: null,
        done: true
      })
    show(state({ repo: activeRepo, moveOut: moveOut() }))
    expect(
      await screen.findByText('Destination server is down.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Stopped while copying images and videos.')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(copyHostedBlueskyMoveOutPreferences).toHaveBeenCalled()
    )
    expect(sendHostedBlueskyMoveOutRepo).toHaveBeenCalledTimes(1)
    expect(copyHostedBlueskyMoveOutBlobs).toHaveBeenCalledTimes(2)
  })

  it('warns about blobs that could not be copied and still offers the switch', async () => {
    vi.mocked(copyHostedBlueskyMoveOutBlobs).mockResolvedValueOnce({
      copied: 1,
      failed: [{ cid: 'bafy1', reason: 'Blob not found on this server.' }],
      cursor: null,
      done: true
    })
    show(state({ repo: activeRepo, moveOut: moveOut() }))
    expect(
      await screen.findByText(
        "1 image or video couldn't be copied to bsky.social."
      )
    ).toBeInTheDocument()
    // The step is not ticked, but the settings still copy.
    expect(
      screen.queryByText('Images and videos: 2 copied')
    ).not.toBeInTheDocument()
    expect(copyHostedBlueskyMoveOutPreferences).toHaveBeenCalled()
    // The switch stays available and its dialog warns about the missing files.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch to bsky.social' })
    )
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText(
        /1 image or video will be missing on bsky\.social\./
      )
    ).toBeInTheDocument()
  })

  it('retries the failed blobs from no cursor', async () => {
    vi.mocked(copyHostedBlueskyMoveOutBlobs)
      .mockResolvedValueOnce({
        copied: 0,
        failed: [{ cid: 'bafy1', reason: 'Blob not found on this server.' }],
        cursor: null,
        done: true
      })
      .mockResolvedValueOnce({
        copied: 1,
        failed: [],
        cursor: null,
        done: true
      })
    show(state({ repo: activeRepo, moveOut: moveOut() }))
    const retry = await screen.findByRole('button', { name: 'Try again' })
    fireEvent.click(retry)
    await waitFor(() =>
      expect(copyHostedBlueskyMoveOutBlobs).toHaveBeenCalledTimes(2)
    )
    // The retry starts the blob step over, without the old cursor.
    expect(copyHostedBlueskyMoveOutBlobs).toHaveBeenNthCalledWith(2, {
      limit: 100
    })
    expect(
      await screen.findByText('Images and videos: 1 copied')
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/couldn't be copied to bsky\.social/)
    ).not.toBeInTheDocument()
  })

  it('keeps copying when a batch only ran out of its time budget', async () => {
    vi.mocked(copyHostedBlueskyMoveOutBlobs)
      .mockResolvedValueOnce({
        copied: 1,
        failed: [],
        cursor: 'same',
        done: false
      })
      // Called with 'same', it ran out of time and hands 'same' back: that is
      // progress (it copied), not a stuck destination.
      .mockResolvedValueOnce({
        copied: 1,
        failed: [],
        cursor: 'same',
        done: false
      })
      .mockResolvedValueOnce({
        copied: 1,
        failed: [],
        cursor: null,
        done: true
      })
    show(state({ repo: activeRepo, moveOut: moveOut() }))
    expect(
      await screen.findByText('Images and videos: 3 copied')
    ).toBeInTheDocument()
    expect(copyHostedBlueskyMoveOutBlobs).toHaveBeenCalledTimes(3)
    expect(copyHostedBlueskyMoveOutBlobs).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: 'same' })
    )
    expect(
      screen.queryByText(
        'The destination server stopped making progress. Try again.'
      )
    ).not.toBeInTheDocument()
  })

  it('stops when the destination stops making progress', async () => {
    vi.mocked(copyHostedBlueskyMoveOutBlobs).mockResolvedValue({
      copied: 0,
      failed: [],
      cursor: 'same',
      done: false
    })
    show(state({ repo: activeRepo, moveOut: moveOut() }))
    expect(
      await screen.findByText(
        'The destination server stopped making progress. Try again.'
      )
    ).toBeInTheDocument()
  })

  it('stops after too many blob pages', async () => {
    let page = 0
    vi.mocked(copyHostedBlueskyMoveOutBlobs).mockImplementation(async () => {
      page += 1
      return { copied: 0, failed: [], cursor: `c${page}`, done: false }
    })
    show(state({ repo: activeRepo, moveOut: moveOut() }))
    expect(
      await screen.findByText(
        'Copying images and videos took too many steps. Try again.'
      )
    ).toBeInTheDocument()
    expect(copyHostedBlueskyMoveOutBlobs).toHaveBeenCalledTimes(100)
  })

  it('switches only after the current password', async () => {
    vi.mocked(finishHostedBlueskyMoveOut).mockResolvedValue({
      movedTo: 'bsky.social',
      handle: 'alex.bsky.social',
      missingBlobs: 0,
      state: state({
        repo: { ...activeRepo, status: 'deactivated' },
        movedTo: 'bsky.social'
      })
    })
    show(state({ repo: activeRepo, moveOut: moveOut() }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch to bsky.social' })
    )
    const dialog = screen.getByRole('dialog')
    const submit = within(dialog).getByRole('button', {
      name: 'Switch to bsky.social'
    })
    expect(submit).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'hunter2' }
    })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(finishHostedBlueskyMoveOut).toHaveBeenCalledWith('hunter2')
    )
    expect(await screen.findByText('Moved to bsky.social')).toBeInTheDocument()
  })

  it('says how many files the switch could not copy', async () => {
    vi.mocked(finishHostedBlueskyMoveOut).mockResolvedValue({
      movedTo: 'bsky.social',
      handle: 'alex.bsky.social',
      missingBlobs: 2,
      state: state({
        repo: { ...activeRepo, status: 'deactivated' },
        movedTo: 'bsky.social'
      })
    })
    show(state({ repo: activeRepo, moveOut: moveOut() }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch to bsky.social' })
    )
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'hunter2' }
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Switch to bsky.social' })
    )
    expect(
      await screen.findByText(
        "Moved to bsky.social. 2 images or videos couldn't be copied."
      )
    ).toBeInTheDocument()
  })

  it('finishes an interrupted switch after the current password', async () => {
    vi.mocked(finishHostedBlueskyMoveOut).mockResolvedValue({
      movedTo: 'bsky.social',
      handle: 'alex.bsky.social',
      missingBlobs: 0,
      state: state({
        repo: { ...activeRepo, status: 'deactivated' },
        movedTo: 'bsky.social'
      })
    })
    show(state({ repo: activeRepo, moveOut: moveOut('switched') }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish the move' }))
    const dialog = screen.getByRole('dialog')
    const submit = within(dialog).getByRole('button', {
      name: 'Finish the move'
    })
    expect(submit).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Current password'), {
      target: { value: 'hunter2' }
    })
    fireEvent.click(submit)
    await waitFor(() =>
      expect(finishHostedBlueskyMoveOut).toHaveBeenCalledWith('hunter2')
    )
  })

  it('cancels the move with DELETE', async () => {
    vi.mocked(cancelHostedBlueskyMoveOut).mockResolvedValue({
      cancelled: true,
      pdsUrl: 'https://bsky.social',
      handle: 'alex.bsky.social',
      remoteAccountRemains: true,
      message: 'Move cancelled.',
      state: state({ repo: activeRepo })
    })
    show(state({ repo: activeRepo, moveOut: moveOut() }))
    expect(
      screen.getByText(
        'Cancelling leaves the switched-off account on bsky.social; delete it there if you want.'
      )
    ).toBeInTheDocument()
    const cancel = await screen.findByRole('button', {
      name: 'Cancel the move'
    })
    await waitFor(() => expect(cancel).toBeEnabled())
    fireEvent.click(cancel)
    await waitFor(() => expect(cancelHostedBlueskyMoveOut).toHaveBeenCalled())
    expect(await screen.findByText('Move cancelled.')).toBeInTheDocument()
  })

  it('shows a moved account with only the copy’s delete action', () => {
    show(
      state({
        repo: { ...activeRepo, status: 'deactivated' },
        movedTo: 'bsky.social'
      })
    )
    expect(screen.getByText('Moved to bsky.social')).toBeInTheDocument()
    expect(
      screen.getByText(/Link it again under “Your Bluesky account”/)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Turn on' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Change' })
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Recovery key')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete the copy left here' })
    )
    expect(
      screen.getByRole('heading', { name: 'Delete the copy left here?' })
    ).toBeInTheDocument()
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText(/The account on bsky\.social is not affected/)
    ).toBeInTheDocument()
    // The switch cleared the handle here, so there is nothing to type back.
    expect(within(dialog).queryByLabelText('Handle')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/to confirm/)).not.toBeInTheDocument()
  })
})
