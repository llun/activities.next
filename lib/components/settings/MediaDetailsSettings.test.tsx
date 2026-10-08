/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { GallerySettingsEntity } from '@/lib/services/gallery/galleryEntities'

import { MediaDetailsSettings } from './MediaDetailsSettings'

const mockGetGallerySettings = vi.fn()
const mockUpdateGallerySettings = vi.fn()

vi.mock('@/lib/client', () => ({
  getGallerySettings: () => mockGetGallerySettings(),
  updateGallerySettings: (patch: unknown) => mockUpdateGallerySettings(patch)
}))

const baseSettings: GallerySettingsEntity = {
  autoDescribe: true,
  allowEmptyDescription: true,
  subjectHashtags: false,
  galleryDefault: 'subject',
  defaultPlacePrecision: 'hidden',
  showGear: true,
  mapPublic: true,
  lifeListPublic: false,
  hiddenLocations: [],
  hideThreatenedPlaces: true,
  subjectSuggestionMode: 'model',
  subjectConfidenceThreshold: 70,
  altTextAvailable: true,
  subjectSuggestionsAvailable: true,
  subjectModel: 'test-vision-model',
  speciesLookupsAvailable: true,
  placeLookupsAvailable: true
}

const AUTO_DESCRIBE = 'Describe new photos and videos automatically'
const ALLOW_EMPTY = 'Allow posting media without a description'
const SUBJECT_HASHTAGS = 'Add subjects as hashtags'

describe('MediaDetailsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGallerySettings.mockResolvedValue(baseSettings)
    mockUpdateGallerySettings.mockImplementation(async (patch) => ({
      ...baseSettings,
      ...patch
    }))
  })

  it('loads the settings and shows their values', async () => {
    render(<MediaDetailsSettings />)

    expect(
      await screen.findByRole('switch', { name: AUTO_DESCRIBE })
    ).toBeChecked()
    expect(screen.getByRole('switch', { name: ALLOW_EMPTY })).toBeChecked()
    expect(
      screen.getByRole('switch', { name: SUBJECT_HASHTAGS })
    ).not.toBeChecked()
    expect(screen.getByRole('switch', { name: AUTO_DESCRIBE })).toBeEnabled()
    expect(
      screen.queryByText('Not available on this server.')
    ).not.toBeInTheDocument()
  })

  it('disables auto describe when alt text is not configured', async () => {
    mockGetGallerySettings.mockResolvedValue({
      ...baseSettings,
      altTextAvailable: false
    })

    render(<MediaDetailsSettings />)

    expect(
      await screen.findByText('Not available on this server.')
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: AUTO_DESCRIBE })).toBeDisabled()
  })

  it('saves a toggle immediately with only the changed key', async () => {
    render(<MediaDetailsSettings />)

    const hashtags = await screen.findByRole('switch', {
      name: SUBJECT_HASHTAGS
    })
    fireEvent.click(hashtags)

    await waitFor(() =>
      expect(mockUpdateGallerySettings).toHaveBeenCalledWith({
        subjectHashtags: true
      })
    )
    expect(hashtags).toBeChecked()
  })

  it('no longer offers the default place precision', async () => {
    render(<MediaDetailsSettings />)

    await screen.findByRole('switch', { name: AUTO_DESCRIBE })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Location' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Default place precision')
    ).not.toBeInTheDocument()
  })

  it('points to the Gallery privacy and gear pages', async () => {
    render(<MediaDetailsSettings />)

    await screen.findByRole('switch', { name: AUTO_DESCRIBE })
    expect(screen.getByText(/are in/)).toHaveTextContent(
      'Place privacy, map and gear settings are in Gallery privacy and Gallery gear.'
    )
    expect(
      screen.getByRole('link', { name: 'Gallery privacy' })
    ).toHaveAttribute('href', '/gallery/privacy')
    expect(screen.getByRole('link', { name: 'Gallery gear' })).toHaveAttribute(
      'href',
      '/gallery/gear'
    )
  })

  it('reverts the toggle and shows an error when saving fails', async () => {
    mockUpdateGallerySettings.mockRejectedValue(new Error('network down'))

    render(<MediaDetailsSettings />)

    const emptyDescription = await screen.findByRole('switch', {
      name: ALLOW_EMPTY
    })
    fireEvent.click(emptyDescription)

    expect(
      await screen.findByText(
        'Failed to save media settings. Please try again.'
      )
    ).toBeInTheDocument()
    expect(mockUpdateGallerySettings).toHaveBeenCalledWith({
      allowEmptyDescription: false
    })
    await waitFor(() => expect(emptyDescription).toBeChecked())
  })
  it('shows a retry when loading fails and recovers on retry', async () => {
    mockGetGallerySettings
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue(baseSettings)

    render(<MediaDetailsSettings />)

    expect(
      await screen.findByText('Failed to load media settings.')
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: AUTO_DESCRIBE })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(
      await screen.findByRole('switch', { name: AUTO_DESCRIBE })
    ).toBeEnabled()
    expect(
      screen.queryByText('Failed to load media settings.')
    ).not.toBeInTheDocument()
    expect(mockGetGallerySettings).toHaveBeenCalledTimes(2)
  })

  it('announces a successful save in a polite status region', async () => {
    render(<MediaDetailsSettings />)

    const hashtags = await screen.findByRole('switch', {
      name: SUBJECT_HASHTAGS
    })
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()

    fireEvent.click(hashtags)

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('does not announce Saved when the save fails', async () => {
    mockUpdateGallerySettings.mockRejectedValue(new Error('network down'))

    render(<MediaDetailsSettings />)

    fireEvent.click(
      await screen.findByRole('switch', { name: SUBJECT_HASHTAGS })
    )

    expect(
      await screen.findByText(
        'Failed to save media settings. Please try again.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('keeps the switch enabled and focused, marked busy, while its save is in flight', async () => {
    let resolveSave: (value: GallerySettingsEntity) => void = () => {}
    mockUpdateGallerySettings.mockReturnValue(
      new Promise<GallerySettingsEntity>((resolve) => {
        resolveSave = resolve
      })
    )

    render(<MediaDetailsSettings />)

    const hashtags = await screen.findByRole('switch', {
      name: SUBJECT_HASHTAGS
    })
    hashtags.focus()
    fireEvent.click(hashtags)

    expect(hashtags).toBeChecked()
    expect(hashtags).toBeEnabled()
    expect(hashtags).toHaveFocus()
    expect(hashtags).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('switch', { name: ALLOW_EMPTY })).toBeEnabled()
    expect(screen.getByRole('switch', { name: AUTO_DESCRIBE })).toBeEnabled()

    resolveSave({ ...baseSettings, subjectHashtags: true })

    await waitFor(() => expect(hashtags).toHaveAttribute('aria-busy', 'false'))
    expect(hashtags).toBeChecked()
    expect(hashtags).toHaveFocus()
  })

  it('ignores a repeat toggle while the same switch is saving', async () => {
    let resolveSave: (value: GallerySettingsEntity) => void = () => {}
    mockUpdateGallerySettings.mockReturnValue(
      new Promise<GallerySettingsEntity>((resolve) => {
        resolveSave = resolve
      })
    )

    render(<MediaDetailsSettings />)

    const hashtags = await screen.findByRole('switch', {
      name: SUBJECT_HASHTAGS
    })
    fireEvent.click(hashtags)
    fireEvent.click(hashtags)

    expect(mockUpdateGallerySettings).toHaveBeenCalledTimes(1)
    expect(hashtags).toBeChecked()

    resolveSave({ ...baseSettings, subjectHashtags: true })
    await waitFor(() => expect(hashtags).toHaveAttribute('aria-busy', 'false'))
    expect(hashtags).toBeChecked()
  })

  it('keeps two saves for different switches independent', async () => {
    const resolvers: Array<(value: GallerySettingsEntity) => void> = []
    mockUpdateGallerySettings.mockImplementation(
      () =>
        new Promise<GallerySettingsEntity>((resolve) => {
          resolvers.push(resolve)
        })
    )

    render(<MediaDetailsSettings />)

    const hashtags = await screen.findByRole('switch', {
      name: SUBJECT_HASHTAGS
    })
    const allowEmpty = screen.getByRole('switch', { name: ALLOW_EMPTY })
    fireEvent.click(hashtags)
    fireEvent.click(allowEmpty)

    expect(hashtags).toHaveAttribute('aria-busy', 'true')
    expect(allowEmpty).toHaveAttribute('aria-busy', 'true')
    expect(mockUpdateGallerySettings).toHaveBeenCalledTimes(2)

    resolvers[0]({ ...baseSettings, subjectHashtags: true })

    await waitFor(() => expect(hashtags).toHaveAttribute('aria-busy', 'false'))
    expect(allowEmpty).toHaveAttribute('aria-busy', 'true')

    resolvers[1]({ ...baseSettings, allowEmptyDescription: false })

    await waitFor(() =>
      expect(allowEmpty).toHaveAttribute('aria-busy', 'false')
    )
  })
})
