/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import * as client from '@/lib/client'

import { ChangeNameForm } from './ChangeNameForm'

vi.mock('@/lib/client', () => ({
  updateAccountName: vi.fn()
}))

const mockUpdateAccountName = vi.mocked(client.updateAccountName)

describe('ChangeNameForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the form with method="post" so the named input is never GET-serialized into the URL', () => {
    const { container } = render(<ChangeNameForm currentName="Ada Lovelace" />)

    const form = container.querySelector('form')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'post')
  })

  it('submits name update successfully and shows feedback message', async () => {
    mockUpdateAccountName.mockResolvedValueOnce({ success: true })

    render(<ChangeNameForm currentName="Ada Lovelace" />)

    const input = screen.getByLabelText(/name/i)
    fireEvent.change(input, { target: { value: 'Augusta Ada King' } })

    const submitBtn = screen.getByRole('button', { name: /update name/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mockUpdateAccountName).toHaveBeenCalledWith({
        name: 'Augusta Ada King'
      })
      expect(screen.getByText('Name updated successfully!')).toBeInTheDocument()
    })
  })

  it('displays API error and re-enables submit button on failure', async () => {
    mockUpdateAccountName.mockRejectedValueOnce(new Error('Invalid name'))

    render(<ChangeNameForm currentName="Ada Lovelace" />)

    const input = screen.getByLabelText(/name/i)
    fireEvent.change(input, { target: { value: 'Bad Name' } })

    const submitBtn = screen.getByRole('button', { name: /update name/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('Invalid name')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /update name/i })).toBeEnabled()
  })

  it('handles network or non-Error failures with fallback error', async () => {
    mockUpdateAccountName.mockRejectedValueOnce('Network failure')

    render(<ChangeNameForm currentName="Ada Lovelace" />)

    const submitBtn = screen.getByRole('button', { name: /update name/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(
        screen.getByText('An error occurred. Please try again.')
      ).toBeInTheDocument()
    })
  })
})
