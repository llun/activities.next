/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import * as client from '@/lib/client'

import { RequestPasswordResetForm } from './RequestPasswordResetForm'

vi.mock('@/lib/client', () => ({
  requestPasswordReset: vi.fn()
}))

const mockRequestPasswordReset = vi.mocked(client.requestPasswordReset)

describe('RequestPasswordResetForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the form with method="post" (defense-in-depth against a native GET submit)', () => {
    render(<RequestPasswordResetForm />)

    const form = screen
      .getByRole('button', { name: /send reset link/i })
      .closest('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })

  it('submits email and displays generic success message without disclosing account existence', async () => {
    mockRequestPasswordReset.mockResolvedValueOnce({
      success: true,
      message:
        'If an account exists for that email, a password reset link has been sent.'
    })

    render(<RequestPasswordResetForm />)

    const emailInput = screen.getByLabelText(/email/i)
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } })

    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({
        email: 'user@example.com'
      })
      expect(
        screen.getByText(
          'If an account exists for that email, a password reset link has been sent.'
        )
      ).toBeInTheDocument()
    })
  })

  it('displays API error and re-enables submit button on failure', async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(new Error('Bad Request'))

    render(<RequestPasswordResetForm />)

    const emailInput = screen.getByLabelText(/email/i)
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } })

    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByText('Bad Request')).toBeInTheDocument()
    })

    expect(
      screen.getByRole('button', { name: /send reset link/i })
    ).toBeEnabled()
  })

  it('handles network failure gracefully', async () => {
    mockRequestPasswordReset.mockRejectedValueOnce(
      new Error('Network error occurred')
    )

    render(<RequestPasswordResetForm />)

    const emailInput = screen.getByLabelText(/email/i)
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } })

    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByText('Network error occurred')).toBeInTheDocument()
    })

    expect(
      screen.getByRole('button', { name: /send reset link/i })
    ).toBeEnabled()
  })

  it('handles non-Error rejection with fallback message', async () => {
    mockRequestPasswordReset.mockRejectedValueOnce('unknown error')

    render(<RequestPasswordResetForm />)

    const emailInput = screen.getByLabelText(/email/i)
    fireEvent.change(emailInput, { target: { value: 'user@example.com' } })

    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(
        screen.getByText('An unexpected error occurred. Please try again.')
      ).toBeInTheDocument()
    })
  })

  it('handles repeated submissions: ignores duplicate submit while in flight and allows retrying afterwards', async () => {
    let resolveRequest: (value: {
      success: boolean
      message: string
    }) => void = () => {}
    mockRequestPasswordReset.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        })
    )

    render(<RequestPasswordResetForm />)

    const emailInput = screen.getByLabelText(/email/i)
    const submitButton = screen.getByRole('button', {
      name: /send reset link/i
    })

    fireEvent.change(emailInput, { target: { value: 'user@example.com' } })
    fireEvent.click(submitButton)

    // Button should now be disabled and text should change to 'Sending...'
    expect(submitButton).toBeDisabled()
    expect(screen.getByText('Sending...')).toBeInTheDocument()
    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(1)

    // Attempting a second submit while in flight should not trigger additional calls
    const form = submitButton.closest('form')
    expect(form).not.toBeNull()
    if (form) {
      fireEvent.submit(form)
    }
    expect(mockRequestPasswordReset).toHaveBeenCalledTimes(1)

    // Resolve the first request
    resolveRequest({
      success: true,
      message:
        'If an account exists for that email, a password reset link has been sent.'
    })

    await waitFor(() => {
      expect(
        screen.getByText(
          'If an account exists for that email, a password reset link has been sent.'
        )
      ).toBeInTheDocument()
    })

    expect(
      screen.getByRole('button', { name: /send reset link/i })
    ).toBeEnabled()

    // Second submission can be performed
    mockRequestPasswordReset.mockResolvedValueOnce({
      success: true,
      message:
        'If an account exists for that email, a password reset link has been sent.'
    })

    fireEvent.change(emailInput, { target: { value: 'another@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(mockRequestPasswordReset).toHaveBeenCalledTimes(2)
      expect(mockRequestPasswordReset).toHaveBeenLastCalledWith({
        email: 'another@example.com'
      })
    })
  })
})
