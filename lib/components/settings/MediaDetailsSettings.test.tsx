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

  it('shows the default place precision and saves a change on its own', async () => {
    render(<MediaDetailsSettings />)

    const select = await screen.findByRole('combobox', {
      name: 'Default place precision'
    })
    expect(select).toHaveValue('hidden')
    expect(
      screen.getByText(
        'Who can see where new photos were taken. You can change it on each photo.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('option').map((option) => option.textContent)
    ).toEqual(['Hidden', 'Country', 'Area (about 5 km)', 'Exact'])

    fireEvent.change(select, { target: { value: 'country' } })

    await waitFor(() =>
      expect(mockUpdateGallerySettings).toHaveBeenCalledWith({
        defaultPlacePrecision: 'country'
      })
    )
    expect(select).toHaveValue('country')
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('reverts the precision and shows an error when saving it fails', async () => {
    mockUpdateGallerySettings.mockRejectedValue(new Error('network down'))

    render(<MediaDetailsSettings />)

    const select = await screen.findByRole('combobox', {
      name: 'Default place precision'
    })
    fireEvent.change(select, { target: { value: 'exact' } })

    expect(
      await screen.findByText(
        'Failed to save media settings. Please try again.'
      )
    ).toBeInTheDocument()
    await waitFor(() => expect(select).toHaveValue('hidden'))
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

  it('keeps the precision select enabled and busy while it saves', async () => {
    mockUpdateGallerySettings.mockReturnValue(new Promise(() => {}))
    render(<MediaDetailsSettings />)

    const select = await screen.findByLabelText('Default place precision')
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.change(select, { target: { value: 'area' } })

    expect(select).toBeEnabled()
    expect(select).toHaveAttribute('aria-busy', 'true')
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
