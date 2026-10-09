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

  it('keeps Save disabled until the name changes', () => {
    render(<ChangeNameForm currentName="Ada Lovelace" />)

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Augusta Ada King' }
    })

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('submits name update successfully and shows Saved, clean again', async () => {
    mockUpdateAccountName.mockResolvedValueOnce({ success: true })

    render(<ChangeNameForm currentName="Ada Lovelace" />)

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Augusta Ada King' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mockUpdateAccountName).toHaveBeenCalledWith({
        name: 'Augusta Ada King'
      })
      expect(screen.getByText('All changes saved')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('submits from the keyboard with Enter in the field', async () => {
    mockUpdateAccountName.mockResolvedValueOnce({ success: true })

    const { container } = render(<ChangeNameForm currentName="Ada Lovelace" />)

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Ada King' }
    })
    fireEvent.submit(container.querySelector('form') as HTMLFormElement)

    await waitFor(() =>
      expect(mockUpdateAccountName).toHaveBeenCalledWith({ name: 'Ada King' })
    )
  })

  it('displays API error and re-enables Save on failure', async () => {
    mockUpdateAccountName.mockRejectedValueOnce(new Error('Invalid name'))

    render(<ChangeNameForm currentName="Ada Lovelace" />)

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Bad Name' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText('Invalid name')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('handles network or non-Error failures with fallback error', async () => {
    mockUpdateAccountName.mockRejectedValueOnce('Network failure')

    render(<ChangeNameForm currentName="Ada Lovelace" />)

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Someone Else' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        screen.getByText('An error occurred. Please try again.')
      ).toBeInTheDocument()
    })
  })
})
