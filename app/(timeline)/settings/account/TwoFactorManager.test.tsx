/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRouter } from 'next/navigation'
import QRCode from 'qrcode'

import { authClient } from '@/lib/services/auth/auth-client'

import { TwoFactorManager } from './TwoFactorManager'

const mockRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: jest.fn()
}))

jest.mock('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: jest.fn()
  }
}))

jest.mock('@/lib/services/auth/auth-client', () => ({
  authClient: {
    twoFactor: {
      enable: jest.fn(),
      disable: jest.fn(),
      generateBackupCodes: jest.fn(),
      verifyTotp: jest.fn()
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
        backupCodes: []
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
    expect(mockRefresh).toHaveBeenCalled()
    expect(
      screen.getByText('Two-factor authentication is on')
    ).toBeInTheDocument()
  })
})
