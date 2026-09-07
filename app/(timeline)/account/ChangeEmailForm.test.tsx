/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import * as client from '@/lib/client'

import { ChangeEmailForm } from './ChangeEmailForm'

vi.mock('@/lib/client', () => ({
  requestEmailChange: vi.fn()
}))

const mockRequestEmailChange = vi.mocked(client.requestEmailChange)

describe('ChangeEmailForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the form with method="post" (defense-in-depth against a native GET submit)', () => {
    const { container } = render(
      <ChangeEmailForm currentEmail="user@example.com" />
    )

    fireEvent.click(screen.getByRole('button', { name: /change email/i }))

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })

  it('submits valid email and shows success message on successful request', async () => {
    mockRequestEmailChange.mockResolvedValueOnce({
      message: 'Verification email sent'
    })

    render(<ChangeEmailForm currentEmail="user@example.com" />)
    fireEvent.click(screen.getByRole('button', { name: /change email/i }))

    const input = screen.getByLabelText(/new email address/i)
    fireEvent.change(input, { target: { value: 'new@example.com' } })

    const submitBtn = screen.getByRole('button', {
      name: /send verification email/i
    })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockRequestEmailChange).toHaveBeenCalledWith({
        newEmail: 'new@example.com'
      })
      expect(
        screen.getByText(/verification email sent! please check your inbox/i)
      ).toBeInTheDocument()
    })

    // Form switches back to the Change Email button view after success
    expect(
      screen.getByRole('button', { name: /change email/i })
    ).toBeInTheDocument()
  })

  it('shows error message and re-enables submit button on API failure', async () => {
    mockRequestEmailChange.mockRejectedValueOnce(
      new Error('Email already in use')
    )

    render(<ChangeEmailForm currentEmail="user@example.com" />)
    fireEvent.click(screen.getByRole('button', { name: /change email/i }))

    const input = screen.getByLabelText(/new email address/i)
    fireEvent.change(input, { target: { value: 'existing@example.com' } })

    const submitBtn = screen.getByRole('button', {
      name: /send verification email/i
    })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('Email already in use')).toBeInTheDocument()
    })

    expect(
      screen.getByRole('button', { name: /send verification email/i })
    ).toBeEnabled()
  })

  it('shows fallback error on network or non-Error failure', async () => {
    mockRequestEmailChange.mockRejectedValueOnce('network error string')

    render(<ChangeEmailForm currentEmail="user@example.com" />)
    fireEvent.click(screen.getByRole('button', { name: /change email/i }))

    const input = screen.getByLabelText(/new email address/i)
    fireEvent.change(input, { target: { value: 'another@example.com' } })

    const submitBtn = screen.getByRole('button', {
      name: /send verification email/i
    })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(
        screen.getByText('An error occurred. Please try again.')
      ).toBeInTheDocument()
    })
  })

  it('resets form state when clicking cancel', () => {
    render(<ChangeEmailForm currentEmail="user@example.com" />)
    fireEvent.click(screen.getByRole('button', { name: /change email/i }))

    const input = screen.getByLabelText(/new email address/i)
    fireEvent.change(input, { target: { value: 'draft@example.com' } })

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    // Back to button
    expect(
      screen.getByRole('button', { name: /change email/i })
    ).toBeInTheDocument()
  })
})
