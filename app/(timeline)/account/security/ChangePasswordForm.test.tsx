/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import * as client from '@/lib/client'

import { ChangePasswordForm } from './ChangePasswordForm'

vi.mock('@/lib/client', () => ({
  changeAccountPassword: vi.fn()
}))

const mockChangeAccountPassword = vi.mocked(client.changeAccountPassword)

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the form with method="post" (defense-in-depth against a native GET submit)', () => {
    const { container } = render(<ChangePasswordForm />)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })

  it('validates password match before calling API', async () => {
    render(<ChangePasswordForm />)

    fireEvent.change(screen.getByLabelText(/^current password/i), {
      target: { value: 'old-secret-123' }
    })
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'new-secret-123' }
    })
    fireEvent.change(screen.getByLabelText(/^confirm new password/i), {
      target: { value: 'different-password' }
    })

    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    expect(screen.getByText('New passwords do not match')).toBeInTheDocument()
    expect(mockChangeAccountPassword).not.toHaveBeenCalled()
  })

  it('validates minimum password length before calling API', async () => {
    render(<ChangePasswordForm />)

    fireEvent.change(screen.getByLabelText(/^current password/i), {
      target: { value: 'old-secret-123' }
    })
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'short' }
    })
    fireEvent.change(screen.getByLabelText(/^confirm new password/i), {
      target: { value: 'short' }
    })

    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    expect(
      screen.getByText('Password must be at least 8 characters long')
    ).toBeInTheDocument()
    expect(mockChangeAccountPassword).not.toHaveBeenCalled()
  })

  it('successfully changes password and clears password inputs', async () => {
    mockChangeAccountPassword.mockResolvedValueOnce({
      success: true,
      message: 'Password changed successfully'
    })

    render(<ChangePasswordForm />)

    const currentInput = screen.getByLabelText(/^current password/i)
    const newInput = screen.getByLabelText(/^new password/i)
    const confirmInput = screen.getByLabelText(/^confirm new password/i)

    fireEvent.change(currentInput, { target: { value: 'old-secret-123' } })
    fireEvent.change(newInput, { target: { value: 'brand-new-secret-123' } })
    fireEvent.change(confirmInput, {
      target: { value: 'brand-new-secret-123' }
    })

    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(mockChangeAccountPassword).toHaveBeenCalledWith({
        currentPassword: 'old-secret-123',
        newPassword: 'brand-new-secret-123'
      })
      expect(
        screen.getByText('Password changed successfully!')
      ).toBeInTheDocument()
    })

    expect(currentInput).toHaveValue('')
    expect(newInput).toHaveValue('')
    expect(confirmInput).toHaveValue('')
  })

  it('displays API error when current password is incorrect and re-enables submit button', async () => {
    mockChangeAccountPassword.mockRejectedValueOnce(
      new Error('Current password is incorrect')
    )

    render(<ChangePasswordForm />)

    fireEvent.change(screen.getByLabelText(/^current password/i), {
      target: { value: 'wrong-pass' }
    })
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'brand-new-secret-123' }
    })
    fireEvent.change(screen.getByLabelText(/^confirm new password/i), {
      target: { value: 'brand-new-secret-123' }
    })

    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(
        screen.getByText('Current password is incorrect')
      ).toBeInTheDocument()
    })

    expect(
      screen.getByRole('button', { name: /change password/i })
    ).toBeEnabled()
  })

  it('handles network or non-Error failure gracefully', async () => {
    mockChangeAccountPassword.mockRejectedValueOnce('network failure')

    render(<ChangePasswordForm />)

    fireEvent.change(screen.getByLabelText(/^current password/i), {
      target: { value: 'pass-12345' }
    })
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'brand-new-secret-123' }
    })
    fireEvent.change(screen.getByLabelText(/^confirm new password/i), {
      target: { value: 'brand-new-secret-123' }
    })

    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(
        screen.getByText('An error occurred. Please try again.')
      ).toBeInTheDocument()
    })
  })
})
