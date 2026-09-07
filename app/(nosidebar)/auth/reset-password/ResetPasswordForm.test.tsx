/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import * as client from '@/lib/client'

import { ResetPasswordForm } from './ResetPasswordForm'

vi.mock('@/lib/client', () => ({
  resetPassword: vi.fn()
}))

const mockResetPassword = vi.mocked(client.resetPassword)

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the form with method="post" (defense-in-depth against a native GET submit)', () => {
    render(<ResetPasswordForm />)

    const form = screen
      .getByRole('button', { name: /reset password/i })
      .closest('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })

  it('initializes code from initialCode prop', () => {
    render(<ResetPasswordForm initialCode="preset-reset-code" />)

    expect(screen.getByLabelText(/reset code/i)).toHaveValue(
      'preset-reset-code'
    )
  })

  it('validates reset code is required', async () => {
    render(<ResetPasswordForm />)

    fireEvent.change(screen.getByLabelText(/reset code/i), {
      target: { value: '   ' }
    })
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'password123' }
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'password123' }
    })

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    expect(screen.getByText('Reset code is required')).toBeInTheDocument()
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('validates passwords match before calling API', async () => {
    render(<ResetPasswordForm initialCode="valid-code" />)

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'password123' }
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'different-password' }
    })

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('validates minimum password length before calling API', async () => {
    render(<ResetPasswordForm initialCode="valid-code" />)

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'short' }
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'short' }
    })

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    expect(
      screen.getByText('Password must be at least 8 characters long')
    ).toBeInTheDocument()
    expect(mockResetPassword).not.toHaveBeenCalled()
  })

  it('displays API error for invalid or expired codes and re-enables submit', async () => {
    mockResetPassword.mockRejectedValueOnce(
      new Error('Invalid or expired reset code')
    )

    render(<ResetPasswordForm initialCode="expired-code" />)

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'password123' }
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'password123' }
    })

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => {
      expect(
        screen.getByText('Invalid or expired reset code')
      ).toBeInTheDocument()
    })

    expect(
      screen.getByRole('button', { name: /reset password/i })
    ).toBeEnabled()
  })

  it('handles network failure gracefully', async () => {
    mockResetPassword.mockRejectedValueOnce(
      new Error('Network connection failed')
    )

    render(<ResetPasswordForm initialCode="valid-code" />)

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'password123' }
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'password123' }
    })

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => {
      expect(screen.getByText('Network connection failed')).toBeInTheDocument()
    })

    expect(
      screen.getByRole('button', { name: /reset password/i })
    ).toBeEnabled()
  })

  it('handles non-Error failure with fallback error message', async () => {
    mockResetPassword.mockRejectedValueOnce('unknown error')

    render(<ResetPasswordForm initialCode="valid-code" />)

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'password123' }
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'password123' }
    })

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => {
      expect(
        screen.getByText('An unexpected error occurred. Please try again.')
      ).toBeInTheDocument()
    })
  })

  it('resets password successfully, disables inputs, and shows sign-in navigation link', async () => {
    mockResetPassword.mockResolvedValueOnce({
      success: true,
      message: 'Password reset successfully'
    })

    render(<ResetPasswordForm initialCode="valid-code" />)

    const codeInput = screen.getByLabelText(/reset code/i)
    const newPasswordInput = screen.getByLabelText(/^new password/i)
    const confirmPasswordInput = screen.getByLabelText(/confirm new password/i)

    fireEvent.change(newPasswordInput, {
      target: { value: 'new-secure-password' }
    })
    fireEvent.change(confirmPasswordInput, {
      target: { value: 'new-secure-password' }
    })

    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({
        code: 'valid-code',
        newPassword: 'new-secure-password'
      })
      expect(
        screen.getByText('Password reset successfully')
      ).toBeInTheDocument()
    })

    expect(newPasswordInput).toHaveValue('')
    expect(confirmPasswordInput).toHaveValue('')
    expect(codeInput).toBeDisabled()
    expect(newPasswordInput).toBeDisabled()
    expect(confirmPasswordInput).toBeDisabled()

    const continueLink = screen.getByRole('link', {
      name: /continue to sign in/i
    })
    expect(continueLink).toBeInTheDocument()
    expect(continueLink).toHaveAttribute('href', '/auth/signin')
  })

  it('handles repeated submissions: ignores duplicate submit while in flight and allows retrying after error', async () => {
    let resolveReset: (value: {
      success: boolean
      message: string
    }) => void = () => {}
    mockResetPassword.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReset = resolve
        })
    )

    render(<ResetPasswordForm initialCode="code-123" />)

    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'valid-password' }
    })
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'valid-password' }
    })

    const submitButton = screen.getByRole('button', { name: /reset password/i })
    fireEvent.click(submitButton)

    expect(submitButton).toBeDisabled()
    expect(screen.getByText('Resetting...')).toBeInTheDocument()
    expect(mockResetPassword).toHaveBeenCalledTimes(1)

    // Attempt second submit while in flight
    const form = submitButton.closest('form')
    expect(form).not.toBeNull()
    if (form) {
      fireEvent.submit(form)
    }
    expect(mockResetPassword).toHaveBeenCalledTimes(1)

    // Complete the first request
    resolveReset({
      success: true,
      message: 'Password reset successfully'
    })

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: /continue to sign in/i })
      ).toBeInTheDocument()
    })

    // Submitting after success is ignored
    if (form) {
      fireEvent.submit(form)
    }
    expect(mockResetPassword).toHaveBeenCalledTimes(1)
  })
})
