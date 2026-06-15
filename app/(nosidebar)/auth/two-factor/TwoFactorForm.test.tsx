/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'

import { authClient } from '@/lib/services/auth/auth-client'

import { TwoFactorForm } from './TwoFactorForm'

const mockPush = vi.fn()
const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: vi.fn()
}))

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: {
    twoFactor: {
      verifyTotp: vi.fn(),
      verifyBackupCode: vi.fn()
    }
  }
}))

describe('TwoFactorForm', () => {
  const mockUseRouter = useRouter as jest.Mock
  const mockVerifyTotp = authClient.twoFactor.verifyTotp as jest.Mock
  const mockVerifyBackupCode = authClient.twoFactor
    .verifyBackupCode as jest.Mock

  beforeEach(() => {
    mockPush.mockReset()
    mockRefresh.mockReset()
    mockVerifyTotp.mockReset()
    mockVerifyBackupCode.mockReset()
    mockUseRouter.mockReturnValue({
      push: mockPush,
      refresh: mockRefresh
    })
  })

  it('verifies an authenticator code and redirects back', async () => {
    mockVerifyTotp.mockResolvedValue({ data: { token: 'token' } })

    render(<TwoFactorForm redirectBack="/settings/account" />)

    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '123456' }
    })
    fireEvent.click(screen.getByLabelText('Trust this device for 30 days'))
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))

    await waitFor(() => {
      expect(mockVerifyTotp).toHaveBeenCalledWith({
        code: '123456',
        trustDevice: true
      })
    })
    expect(mockPush).toHaveBeenCalledWith('/settings/account')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('verifies a backup code when backup mode is selected', async () => {
    mockVerifyBackupCode.mockResolvedValue({ data: { token: 'token' } })

    render(<TwoFactorForm redirectBack="/" />)

    fireEvent.click(screen.getByRole('button', { name: 'Backup code' }))
    fireEvent.change(screen.getByLabelText('Backup code'), {
      target: { value: 'BACKUP-CODE' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))

    await waitFor(() => {
      expect(mockVerifyBackupCode).toHaveBeenCalledWith({
        code: 'BACKUP-CODE',
        trustDevice: false
      })
    })
    expect(mockPush).toHaveBeenCalledWith('/')
  })
})
