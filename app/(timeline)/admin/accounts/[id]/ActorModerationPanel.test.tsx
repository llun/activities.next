/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  adminApproveAccount,
  adminUnsuspendAccount,
  getAdminAccount
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

const account = (overrides: Partial<AdminAccount>): AdminAccount =>
  ({
    id: 'acct-1',
    username: 'target',
    domain: null,
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
      account({ domain: 'remote.example', suspended: true })
    )
    mockUnsuspend.mockResolvedValue(account({ domain: 'remote.example' }))

    render(<ActorModerationPanel actorId="acct-1" username="target" />)

    await waitFor(() =>
      expect(screen.getByText('Suspended')).toBeInTheDocument()
    )
    // Remote actors do not expose login-scoped actions.
    expect(screen.queryByText('Disable login')).not.toBeInTheDocument()
    expect(screen.queryByText('Approve')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Unsuspend' }))
    await waitFor(() => expect(mockUnsuspend).toHaveBeenCalledWith('acct-1'))
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
  })
})
