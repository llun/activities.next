/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'

import { authClient } from '@/lib/services/auth/auth-client'

import { TwoFactorManager } from './TwoFactorManager'

const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: vi.fn()
}))

vi.mock('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: vi.fn()
  }
}))

vi.mock('@/lib/services/auth/auth-client', () => ({
  authClient: {
    twoFactor: {
      enable: vi.fn(),
      disable: vi.fn(),
      generateBackupCodes: vi.fn(),
      verifyTotp: vi.fn()
    }
  }
}))

describe('TwoFactorManager', () => {
  const mockUseRouter = useRouter as jest.Mock
  const mockEnable = authClient.twoFactor.enable as jest.Mock
  const mockDisable = authClient.twoFactor.disable as jest.Mock
  const mockGenerateBackupCodes = authClient.twoFactor
    .generateBackupCodes as jest.Mock
  const mockVerifyTotp = authClient.twoFactor.verifyTotp as jest.Mock
  const mockToDataURL = QRCode.toDataURL as jest.Mock

  beforeEach(() => {
    mockRefresh.mockReset()
    mockEnable.mockReset()
    mockDisable.mockReset()
    mockGenerateBackupCodes.mockReset()
    mockVerifyTotp.mockReset()
    mockToDataURL.mockReset()
    mockToDataURL.mockResolvedValue('data:image/png;base64,qr')
    mockUseRouter.mockReturnValue({
      refresh: mockRefresh
    })
  })

  it('starts setup and renders the authenticator QR data', async () => {
    mockEnable.mockResolvedValue({
      data: {
        totpURI:
          'otpauth://totp/Activities:test@example.com?secret=SECRET123&issuer=Activities',
        backupCodes: ['backup-one', 'backup-two']
      }
    })

    render(<TwoFactorManager enabled={false} serviceName="Activities" />)

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'password' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set up 2FA' }))

    await waitFor(() => {
      expect(mockEnable).toHaveBeenCalledWith({
        password: 'password',
        issuer: 'Activities'
      })
    })

    expect(await screen.findByDisplayValue('SECRET123')).toBeInTheDocument()
    expect(screen.getByText('backup-one')).toBeInTheDocument()
    expect(mockToDataURL).toHaveBeenCalledWith(
      'otpauth://totp/Activities:test@example.com?secret=SECRET123&issuer=Activities',
      {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 192
      }
    )
  })

  it('verifies setup and refreshes account state', async () => {
    mockEnable.mockResolvedValue({
      data: {
        totpURI:
          'otpauth://totp/Activities:test@example.com?secret=SECRET123&issuer=Activities',
        backupCodes: ['backup-after-verify']
      }
    })
    mockVerifyTotp.mockResolvedValue({ data: { token: 'token' } })

    render(<TwoFactorManager enabled={false} serviceName="Activities" />)

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'password' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Set up 2FA' }))

    await screen.findByLabelText('Verification code')
    fireEvent.change(screen.getByLabelText('Verification code'), {
      target: { value: '654321' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))

    await waitFor(() => {
      expect(mockVerifyTotp).toHaveBeenCalledWith({ code: '654321' })
    })
    // Wait for the post-verify re-render before asserting on rendered text and
    // the refresh() call that follows setEnabled() in the same handler.
    expect(
      await screen.findByText('Two-factor authentication is on')
    ).toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
    expect(screen.getByText('Save your backup codes')).toBeInTheDocument()
    expect(screen.getByText('backup-after-verify')).toBeInTheDocument()
  })

  it('disables 2FA after confirming the current password', async () => {
    mockDisable.mockResolvedValue({ data: { success: true } })

    render(<TwoFactorManager enabled={true} serviceName="Activities" />)

    fireEvent.change(
      screen.getByLabelText('Current password', {
        selector: '#twoFactorDisablePassword'
      }),
      {
        target: { value: 'password' }
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Disable 2FA' }))

    await waitFor(() => {
      expect(mockDisable).toHaveBeenCalledWith({ password: 'password' })
    })
    // The "2FA is off" label renders only after the awaited disable() resolves
    // and React re-renders; use findByText so the assertion waits for that
    // re-render instead of racing it.
    expect(await screen.findByText('2FA is off')).toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('generates and renders replacement backup codes', async () => {
    mockGenerateBackupCodes.mockResolvedValue({
      data: { backupCodes: ['new-backup-one', 'new-backup-two'] }
    })

    render(<TwoFactorManager enabled={true} serviceName="Activities" />)

    fireEvent.change(
      screen.getByLabelText('Current password', {
        selector: '#twoFactorBackupPassword'
      }),
      {
        target: { value: 'password' }
      }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate codes' }))

    await waitFor(() => {
      expect(mockGenerateBackupCodes).toHaveBeenCalledWith({
        password: 'password'
      })
    })
    // Codes render after the awaited generateBackupCodes() resolves; wait for
    // that re-render rather than reading synchronously.
    expect(await screen.findByText('new-backup-one')).toBeInTheDocument()
    expect(screen.getByText('new-backup-two')).toBeInTheDocument()
  })
})
