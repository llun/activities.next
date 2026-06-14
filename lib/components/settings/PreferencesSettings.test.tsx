/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { PreferencesInput } from '@/lib/client'

import { PreferencesSettings } from './PreferencesSettings'

const mockUpdatePreferences = jest.fn()

jest.mock('@/lib/client', () => ({
  updatePreferences: (preferences: unknown) =>
    mockUpdatePreferences(preferences)
}))

const initialPreferences: PreferencesInput = {
  visibility: 'public',
  sensitive: false,
  language: 'en',
  expandMedia: 'default',
  expandSpoilers: false,
  autoplayGifs: false
}

describe('PreferencesSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUpdatePreferences.mockResolvedValue(true)
  })

  it('renders posting defaults and reading sections', () => {
    render(<PreferencesSettings initialPreferences={initialPreferences} />)

    expect(screen.getByText('Posting defaults')).toBeInTheDocument()
    expect(screen.getByText('Reading')).toBeInTheDocument()
    expect(screen.getByLabelText('Posting privacy')).toBeInTheDocument()
    expect(screen.getByLabelText('Posting language')).toBeInTheDocument()
  })

  it('disables Save until a preference changes', () => {
    render(<PreferencesSettings initialPreferences={initialPreferences} />)

    const save = screen.getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Posting privacy'), {
      target: { value: 'unlisted' }
    })
    expect(save).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('saves changed preferences and shows the saved badge', async () => {
    render(<PreferencesSettings initialPreferences={initialPreferences} />)

    fireEvent.change(screen.getByLabelText('Posting language'), {
      target: { value: 'de' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(mockUpdatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'de' })
      )
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('shows an error message when saving fails', async () => {
    mockUpdatePreferences.mockResolvedValue(false)
    render(<PreferencesSettings initialPreferences={initialPreferences} />)

    fireEvent.change(screen.getByLabelText('Posting privacy'), {
      target: { value: 'private' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(
      await screen.findByText(/Failed to save preferences/i)
    ).toBeInTheDocument()
  })
})
