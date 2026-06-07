/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { translateStatus } from '@/lib/client'
import { Translation } from '@/lib/types/mastodon/translation'

import { TranslateContent } from './translate-content'

jest.mock('@/lib/client', () => ({
  translateStatus: jest.fn()
}))

const translation: Translation = {
  content: '<p>Bonjour le monde</p>',
  spoiler_text: '',
  media_attachments: [],
  poll: null,
  detected_source_language: 'en',
  provider: 'DeepL.com'
}

const renderContent = (language: string | null = 'en') =>
  render(
    <TranslateContent
      statusId="https://activities.local/users/llun/statuses/1"
      language={language}
    >
      <div>Hello world</div>
    </TranslateContent>
  )

describe('TranslateContent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not offer translation when the status has no language', () => {
    renderContent(null)
    expect(
      screen.queryByRole('button', { name: 'Translate' })
    ).not.toBeInTheDocument()
  })

  it('shows the translation and a toggle back to the original', async () => {
    ;(translateStatus as jest.Mock).mockResolvedValue(translation)
    renderContent('en')

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))

    expect(await screen.findByText('Bonjour le monde')).toBeInTheDocument()
    expect(screen.queryByText('Hello world')).not.toBeInTheDocument()
    expect(
      screen.getByText(/Translated from en · DeepL\.com/)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show original' }))
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.queryByText('Bonjour le monde')).not.toBeInTheDocument()

    // Toggling back does not re-request the translation.
    fireEvent.click(screen.getByRole('button', { name: 'Show translation' }))
    expect(screen.getByText('Bonjour le monde')).toBeInTheDocument()
    expect(translateStatus).toHaveBeenCalledTimes(1)
  })

  it('reports when the server cannot translate the status', async () => {
    ;(translateStatus as jest.Mock).mockResolvedValue(null)
    renderContent('en')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    })

    expect(screen.getByText('Translation unavailable')).toBeInTheDocument()
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })
})
