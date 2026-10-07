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
})
