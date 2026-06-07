/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getTranslationCapability, translateStatus } from '@/lib/client'
import { Translation } from '@/lib/types/mastodon/translation'

import { TranslateContent } from './translate-content'

jest.mock('@/lib/client', () => ({
  translateStatus: jest.fn(),
  getTranslationCapability: jest.fn()
}))

const translation: Translation = {
  content: '<p>Bonjour le monde</p>',
  spoiler_text: '',
  language: 'fr',
  media_attachments: [],
  poll: null,
  detected_source_language: 'en',
  provider: 'DeepL.com'
}

const mockCapability = (
  enabled: boolean,
  defaultLanguage: string | null = 'fr'
) =>
  (getTranslationCapability as jest.Mock).mockResolvedValue({
    enabled,
    defaultLanguage
  })

const renderContent = (language: string | null = 'en') =>
  render(
    <TranslateContent
      statusId="https://activities.local/users/llun/statuses/1"
      language={language}
    >
      <div>Hello world</div>
    </TranslateContent>
  )

const findTranslateButton = () =>
  screen.findByRole('button', { name: 'Translate' })

describe('TranslateContent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not offer translation when the status has no language', async () => {
    mockCapability(true)
    renderContent(null)
    await Promise.resolve()
    expect(
      screen.queryByRole('button', { name: 'Translate' })
    ).not.toBeInTheDocument()
  })

  it('does not offer translation when no backend is configured', async () => {
    mockCapability(false)
    renderContent('en')
    await waitFor(() => expect(getTranslationCapability).toHaveBeenCalled())
    expect(
      screen.queryByRole('button', { name: 'Translate' })
    ).not.toBeInTheDocument()
  })

  it('does not offer translation when the status is already in the default language', async () => {
    mockCapability(true, 'en')
    renderContent('en')
    await waitFor(() => expect(getTranslationCapability).toHaveBeenCalled())
    expect(
      screen.queryByRole('button', { name: 'Translate' })
    ).not.toBeInTheDocument()
  })

  it('shows the translation and a toggle back to the original', async () => {
    mockCapability(true, 'fr')
    ;(translateStatus as jest.Mock).mockResolvedValue(translation)
    renderContent('en')

    fireEvent.click(await findTranslateButton())

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

  it('reports when the server returns no translation', async () => {
    mockCapability(true, 'fr')
    ;(translateStatus as jest.Mock).mockResolvedValue(null)
    renderContent('en')

    fireEvent.click(await findTranslateButton())

    expect(
      await screen.findByText('Translation unavailable')
    ).toBeInTheDocument()
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('reports when the translation request throws', async () => {
    mockCapability(true, 'fr')
    ;(translateStatus as jest.Mock).mockRejectedValue(new Error('network'))
    renderContent('en')

    fireEvent.click(await findTranslateButton())

    expect(
      await screen.findByText('Translation unavailable')
    ).toBeInTheDocument()
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })
})
