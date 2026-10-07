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
  defaultPlacePrecision: 'area',
  showGear: true,
  mapPublic: true,
  lifeListPublic: false,
  hiddenLocations: [],
  altTextAvailable: true
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

  it('keeps every switch disabled until the in-flight save settles', async () => {
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

    expect(hashtags).toBeChecked()
    expect(screen.getByRole('switch', { name: ALLOW_EMPTY })).toBeDisabled()
    expect(screen.getByRole('switch', { name: AUTO_DESCRIBE })).toBeDisabled()

    resolveSave({ ...baseSettings, subjectHashtags: true })

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: ALLOW_EMPTY })).toBeEnabled()
    )
    expect(hashtags).toBeChecked()
  })
})
