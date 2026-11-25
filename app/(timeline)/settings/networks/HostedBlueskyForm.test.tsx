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
  createHostedBlueskyAccount,
  deleteHostedBlueskyAccount,
  updateHostedBlueskyAccount
} from '@/lib/client'
import type {
  HostedBlueskyAccountState,
  HostedBlueskyRepoSummary
} from '@/lib/utils/blueskyHosted'

import { HostedBlueskyForm } from './HostedBlueskyForm'

vi.mock('@/lib/client', () => ({
  createHostedBlueskyAccount: vi.fn(),
  deleteHostedBlueskyAccount: vi.fn(),
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
  ...overrides
})

const show = (initialState: HostedBlueskyAccountState, linked = false) =>
  render(<HostedBlueskyForm initialState={initialState} linked={linked} />)

describe('HostedBlueskyForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
})
