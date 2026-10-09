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

  it('renders the form with method="post" (defense-in-depth against a native GET submit)', () => {
    render(<TwoFactorForm redirectBack="/" />)

    const form = screen
      .getByRole('button', { name: 'Verify and sign in' })
      .closest('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })

  it('verifies an authenticator code and redirects back', async () => {
    mockVerifyTotp.mockResolvedValue({ data: { token: 'token' } })

    render(<TwoFactorForm redirectBack="/account/security" />)

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
    expect(mockPush).toHaveBeenCalledWith('/account/security')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('verifies a backup code when backup mode is selected', async () => {
    mockVerifyBackupCode.mockResolvedValue({ data: { token: 'token' } })

    render(<TwoFactorForm redirectBack="/" />)

    fireEvent.click(screen.getByRole('radio', { name: 'Backup code' }))
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

  it('marks a missing code inline, without an alert, and clears it when edited', () => {
    render(<TwoFactorForm redirectBack="/" />)

    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))

    const input = screen.getByLabelText('Verification code')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Verification code is required')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mockVerifyTotp).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '1' } })
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(
      screen.queryByText('Verification code is required')
    ).not.toBeInTheDocument()
  })

  it('announces a rejected code as an alert, not as a field error', async () => {
    mockVerifyTotp.mockResolvedValue({ error: { message: 'Invalid code' } })
    render(<TwoFactorForm redirectBack="/" />)

    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '000000' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('Verification code')).not.toHaveAttribute(
      'aria-invalid'
    )
  })

  it('switches between the authenticator and backup code methods', () => {
    render(<TwoFactorForm redirectBack="/" />)

    expect(
      screen.getByRole('radio', { name: 'Authenticator app' })
    ).toBeChecked()
    expect(screen.getByLabelText('Verification code')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Backup code' }))

    expect(screen.getByRole('radio', { name: 'Backup code' })).toBeChecked()
    expect(screen.queryByLabelText('Verification code')).not.toBeInTheDocument()
  })
})
