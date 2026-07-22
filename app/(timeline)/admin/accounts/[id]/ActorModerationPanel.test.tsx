/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  adminApproveAccount,
  adminDeleteAccount,
  adminRejectAccount,
  adminUnsuspendAccount,
  getAdminAccount,
  performAdminAccountAction
} from '@/lib/client'
import { AdminAccount } from '@/lib/types/mastodon/admin/account'

import { ActorModerationPanel } from './ActorModerationPanel'

vi.mock('@/lib/client', () => ({
  getAdminAccount: vi.fn(),
  performAdminAccountAction: vi.fn(),
  adminUnsuspendAccount: vi.fn(),
  adminUnsilenceAccount: vi.fn(),
  adminUnsensitiveAccount: vi.fn(),
  adminEnableAccount: vi.fn(),
  adminApproveAccount: vi.fn(),
  adminRejectAccount: vi.fn(),
  adminDeleteAccount: vi.fn()
}))

const mockGetAdminAccount = getAdminAccount as unknown as ReturnType<
  typeof vi.fn
>
const mockUnsuspend = adminUnsuspendAccount as unknown as ReturnType<
  typeof vi.fn
>
const mockApprove = adminApproveAccount as unknown as ReturnType<typeof vi.fn>
const mockReject = adminRejectAccount as unknown as ReturnType<typeof vi.fn>
const mockDelete = adminDeleteAccount as unknown as ReturnType<typeof vi.fn>
const mockAction = performAdminAccountAction as unknown as ReturnType<
  typeof vi.fn
>

// A non-null role marks a local (account-backed) actor; remote actors pass
// `role: null`. The panel uses role — not domain — to gate login-scoped actions.
const account = (overrides: Partial<AdminAccount>): AdminAccount =>
  ({
    id: 'acct-1',
    username: 'target',
    domain: null,
    role: {
      id: '-99',
      name: '',
      color: '',
      permissions: '0',
      highlighted: false
    },
    suspended: false,
    silenced: false,
    sensitized: false,
    disabled: false,
    approved: true,
    ...overrides
  }) as AdminAccount

describe('ActorModerationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a Suspended badge and unsuspends a suspended remote actor', async () => {
    mockGetAdminAccount.mockResolvedValue(
      account({ domain: 'remote.example', role: null, suspended: true })
    )
    mockUnsuspend.mockResolvedValue(
      account({ domain: 'remote.example', role: null })
    )

    render(<ActorModerationPanel actorId="acct-1" username="target" />)

    await waitFor(() =>
      expect(screen.getByText('Suspended')).toBeInTheDocument()
    )
    // Remote actors (null role) do not expose login-scoped actions.
    expect(screen.queryByText('Disable login')).not.toBeInTheDocument()
    expect(screen.queryByText('Approve')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Unsuspend' }))
    await waitFor(() => expect(mockUnsuspend).toHaveBeenCalledWith('acct-1'))
  })

  it('treats a local actor on a secondary domain as local (login actions shown)', async () => {
    // domain is non-null (secondary served domain) but role is set → local.
    mockGetAdminAccount.mockResolvedValue(account({ domain: 'second.example' }))

    render(<ActorModerationPanel actorId="acct-1" username="target" />)

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Disable login' })
      ).toBeInTheDocument()
    )
  })

  it('offers Approve/Reject for a pending local account', async () => {
    mockGetAdminAccount.mockResolvedValue(
      account({ domain: null, approved: false })
    )
    mockApprove.mockResolvedValue(account({ approved: true }))

    render(<ActorModerationPanel actorId="acct-1" username="target" />)

    await waitFor(() => expect(screen.getByText('Pending')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('acct-1'))

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(mockReject).toHaveBeenCalledWith('acct-1'))
  })

  it.each([
    { label: 'Suspend', type: 'suspend' },
    { label: 'Silence', type: 'silence' },
    { label: 'Mark sensitive', type: 'sensitive' },
    { label: 'Disable login', type: 'disable' }
  ])(
    'routes the $label primary action through performAdminAccountAction',
    async ({ label, type }) => {
      mockGetAdminAccount.mockResolvedValue(account({ domain: null }))
      mockAction.mockResolvedValue(undefined)

      render(<ActorModerationPanel actorId="acct-1" username="target" />)

      await waitFor(() =>
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
      )
      fireEvent.click(screen.getByRole('button', { name: label }))
      await waitFor(() =>
        expect(mockAction).toHaveBeenCalledWith({ id: 'acct-1', type })
      )
    }
  )

  it('confirms before deleting a suspended account', async () => {
    mockGetAdminAccount.mockResolvedValue(account({ suspended: true }))
    mockDelete.mockResolvedValue(account({ suspended: true }))
    const confirmSpy = vi.spyOn(window, 'confirm')

    render(<ActorModerationPanel actorId="acct-1" username="target" />)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Delete permanently' })
      ).toBeInTheDocument()
    )

    // Declining the confirm dialog does not call the API.
    confirmSpy.mockReturnValueOnce(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(mockDelete).not.toHaveBeenCalled()

    // Accepting it does.
    confirmSpy.mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('acct-1'))
    confirmSpy.mockRestore()
  })
})
