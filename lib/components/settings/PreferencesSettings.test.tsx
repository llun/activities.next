/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { PreferencesInput } from '@/lib/client'
import {
  PlaybackPreferencesProvider,
  usePlaybackPreferences
} from '@/lib/components/preferences/PlaybackPreferencesContext'

import { PreferencesSettings } from './PreferencesSettings'

const mockUpdatePreferences = vi.fn()

vi.mock('@/lib/client', () => ({
  updatePreferences: (preferences: unknown) =>
    mockUpdatePreferences(preferences)
}))

const initialPreferences: PreferencesInput = {
  visibility: 'public',
  quotePolicy: 'public',
  sensitive: false,
  language: 'en',
  expandMedia: 'default',
  expandSpoilers: false,
  autoplayGifs: false
}

describe('PreferencesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdatePreferences.mockResolvedValue(true)
  })

  it('renders posting defaults and reading sections', () => {
    render(<PreferencesSettings initialPreferences={initialPreferences} />)

    expect(screen.getByText('Posting defaults')).toBeInTheDocument()
    expect(screen.getByText('Reading')).toBeInTheDocument()
    expect(screen.getByLabelText('Posting privacy')).toBeInTheDocument()
    expect(screen.getByLabelText('Who can quote')).toBeInTheDocument()
    expect(screen.getByLabelText('Posting language')).toBeInTheDocument()
  })

  it('saves the changed quote policy', async () => {
    render(<PreferencesSettings initialPreferences={initialPreferences} />)

    fireEvent.change(screen.getByLabelText('Who can quote'), {
      target: { value: 'followers' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(mockUpdatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ quotePolicy: 'followers' })
      )
    )
  })

  it('reflects the initial quote policy in the select', () => {
    render(
      <PreferencesSettings
        initialPreferences={{ ...initialPreferences, quotePolicy: 'nobody' }}
      />
    )

    expect(
      (screen.getByLabelText('Who can quote') as HTMLSelectElement).value
    ).toBe('nobody')
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
    // After a successful save the form is no longer dirty, so Save disables
    // again until the next change.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
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

  it('updates PlaybackPreferencesContext when autoplayGifs is saved', async () => {
    const Consumer = () => {
      const { autoplayGifs } = usePlaybackPreferences()
      return <div data-testid="context-val">{String(autoplayGifs)}</div>
    }

    render(
      <PlaybackPreferencesProvider actorId="act-1" initialAutoplayGifs={false}>
        <Consumer />
        <PreferencesSettings initialPreferences={initialPreferences} />
      </PlaybackPreferencesProvider>
    )

    expect(screen.getByTestId('context-val').textContent).toBe('false')

    fireEvent.click(screen.getByLabelText('Autoplay animated GIFs'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(mockUpdatePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ autoplayGifs: true })
      )
    )

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByTestId('context-val').textContent).toBe('true')
  })

  describe('media display rows', () => {
    it('stacks each option title over its helper instead of laying them side by side', () => {
      render(<PreferencesSettings initialPreferences={initialPreferences} />)

      const label = screen.getByText('Show all media').closest('label')
      expect(label).not.toBeNull()
      // The shared Label is a flex row; this row turns it into a column so the
      // helper falls under the title, which is what the design draws.
      expect(label).toHaveClass('flex-col', 'items-start')
      const [title, helper] = Array.from(label?.children ?? [])
      expect(title).toHaveTextContent('Show all media')
      expect(helper).toHaveTextContent('Including media marked as sensitive.')
      // 14/20 title over a 12/16 helper.
      expect(title).toHaveClass('text-sm', 'font-medium')
      expect(helper).toHaveClass('text-xs')
    })

    it('makes every row 68 high, with a divider under all but the last', () => {
      render(<PreferencesSettings initialPreferences={initialPreferences} />)

      const group = screen.getByRole('radiogroup', { name: 'Media display' })
      const rows = Array.from(group.children)
      expect(rows).toHaveLength(3)
      for (const row of rows) expect(row).toHaveClass('min-h-[68px]')
      expect(rows[0]).toHaveClass('border-b')
      expect(rows[1]).toHaveClass('border-b')
      expect(rows[2]).not.toHaveClass('border-b')
    })

    it('still selects an option from its label and tints the chosen row', () => {
      render(<PreferencesSettings initialPreferences={initialPreferences} />)

      const group = screen.getByRole('radiogroup', { name: 'Media display' })
      expect(group.children[0]).toHaveClass('bg-primary/5')

      fireEvent.click(screen.getByText('Hide all media'))
      expect(
        screen.getByRole('radio', { name: /Hide all media/ })
      ).toBeChecked()
      expect(group.children[2]).toHaveClass('bg-primary/5')
      expect(group.children[0]).not.toHaveClass('bg-primary/5')
    })
  })
})
