/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { GallerySettingsEntity } from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'

import { GalleryPrivacySettings } from './GalleryPrivacySettings'

const mockGetGallerySettings = vi.fn()
const mockUpdateGallerySettings = vi.fn()

vi.mock('@/lib/client', () => ({
  getGallerySettings: () => mockGetGallerySettings(),
  updateGallerySettings: (patch: unknown) => mockUpdateGallerySettings(patch)
}))
// The GL loaders never resolve, so the hidden-locations map stays initializing.
vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn(() => new Promise(() => {}))
}))
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
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
  hiddenLocations: [
    { latitude: 13.7563, longitude: 100.5018, hideRadiusMeters: 1000 }
  ],
  hideThreatenedPlaces: true,
  subjectSuggestionMode: 'model',
  subjectConfidenceThreshold: 70,
  altTextAvailable: true,
  subjectSuggestionsAvailable: true,
  subjectModel: 'test-vision-model',
  speciesLookupsAvailable: true,
  placeLookupsAvailable: true
}

const SHOW_GEAR = 'Show gear and exposure on my media'
const MAP_PUBLIC = 'Show my gallery map to others'
const LIFE_LIST = 'Let others see my life list'
const THREATENED = 'Hide the place for threatened species'
const NO_LOOKUPS_NOTICE =
  'This server can’t check IUCN status, so places of photos with a species name stay hidden while this is on.'
const PRECISION = 'Default precision for new media'
const GALLERY_DEFAULT = 'Add new photos and videos to my gallery'

const renderSettings = () =>
  render(<GalleryPrivacySettings mapProvider={{ type: 'osm' }} />)

describe('GalleryPrivacySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGallerySettings.mockResolvedValue(baseSettings)
    mockUpdateGallerySettings.mockImplementation(async (patch) => ({
      ...baseSettings,
      ...patch
    }))
  })

  it('loads the settings into the switches and selects', async () => {
    renderSettings()

    expect(await screen.findByRole('switch', { name: SHOW_GEAR })).toBeChecked()
    expect(screen.getByRole('switch', { name: MAP_PUBLIC })).toBeChecked()
    expect(screen.getByRole('switch', { name: LIFE_LIST })).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: PRECISION })).toHaveValue(
      'hidden'
    )
    expect(screen.getByRole('combobox', { name: GALLERY_DEFAULT })).toHaveValue(
      'subject'
    )
    expect(
      screen
        .getAllByRole('option', { name: /Hidden|Country|Area|Exact/ })
        .map((option) => option.textContent)
    ).toEqual(['Hidden', 'Country', 'Area (about 5 km)', 'Exact'])
  })

  it('disables every control until the settings are known', async () => {
    const deferred = createDeferred<GallerySettingsEntity>()
    mockGetGallerySettings.mockReturnValue(deferred.promise)

    renderSettings()

    expect(screen.getByRole('switch', { name: MAP_PUBLIC })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: PRECISION })).toBeDisabled()

    deferred.resolve(baseSettings)
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: MAP_PUBLIC })).toBeEnabled()
    )
  })

  it.each([
    [SHOW_GEAR, 'switch', 'showGear', false],
    [MAP_PUBLIC, 'switch', 'mapPublic', false],
    [LIFE_LIST, 'switch', 'lifeListPublic', true],
    [THREATENED, 'switch', 'hideThreatenedPlaces', false]
  ])(
    'saves %s on its own with only that key',
    async (name, role, key, value) => {
      renderSettings()

      fireEvent.click(await screen.findByRole(role, { name }))

      await waitFor(() =>
        expect(mockUpdateGallerySettings).toHaveBeenCalledWith({ [key]: value })
      )
      expect(await screen.findByText('Saved')).toBeInTheDocument()
    }
  )

  it('explains the threatened-species switch and shows no notice when lookups work', async () => {
    renderSettings()

    expect(
      await screen.findByRole('switch', { name: THREATENED })
    ).toBeChecked()
    expect(
      screen.getByText(
        'Uses IUCN status from GBIF. Overrides the precision above.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(NO_LOOKUPS_NOTICE)).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'A species’ place stays hidden until its status has been checked.'
      )
    ).toBeInTheDocument()
  })

  it('explains what place lookups send, or that there are none', async () => {
    const { unmount } = renderSettings()
    expect(
      await screen.findByText(/sent only the centre of the roughly 5 km area/)
    ).toBeInTheDocument()
    unmount()

    mockGetGallerySettings.mockResolvedValue({
      ...baseSettings,
      placeLookupsAvailable: false
    })
    renderSettings()
    expect(
      await screen.findByText(
        'This server doesn’t look up place names, so you type them yourself.'
      )
    ).toBeInTheDocument()
  })

  it('says species places stay hidden when the server cannot check IUCN status', async () => {
    mockGetGallerySettings.mockResolvedValue({
      ...baseSettings,
      speciesLookupsAvailable: false
    })
    renderSettings()

    expect(await screen.findByText(NO_LOOKUPS_NOTICE)).toBeInTheDocument()
  })

  it('does not flash the notice before the settings are known', () => {
    mockGetGallerySettings.mockReturnValue(new Promise(() => {}))
    renderSettings()

    expect(screen.queryByText(NO_LOOKUPS_NOTICE)).not.toBeInTheDocument()
  })

  it('saves the default place precision and the gallery default on their own', async () => {
    renderSettings()

    fireEvent.change(await screen.findByRole('combobox', { name: PRECISION }), {
      target: { value: 'area' }
    })
    await waitFor(() =>
      expect(mockUpdateGallerySettings).toHaveBeenCalledWith({
        defaultPlacePrecision: 'area'
      })
    )

    fireEvent.change(screen.getByRole('combobox', { name: GALLERY_DEFAULT }), {
      target: { value: 'never' }
    })
    await waitFor(() =>
      expect(mockUpdateGallerySettings).toHaveBeenCalledWith({
        galleryDefault: 'never'
      })
    )
    expect(screen.getByRole('combobox', { name: PRECISION })).toHaveValue(
      'area'
    )
  })

  it('reverts only the failed control and says the save failed', async () => {
    mockUpdateGallerySettings.mockRejectedValue(new Error('network down'))
    renderSettings()

    const select = await screen.findByRole('combobox', { name: PRECISION })
    fireEvent.change(select, { target: { value: 'exact' } })

    expect(
      await screen.findByText(
        'Failed to save privacy settings. Please try again.'
      )
    ).toBeInTheDocument()
    await waitFor(() => expect(select).toHaveValue('hidden'))
    expect(screen.getByRole('switch', { name: MAP_PUBLIC })).toBeChecked()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('keeps a switch enabled and marked busy while its save is in flight', async () => {
    const deferred = createDeferred<GallerySettingsEntity>()
    mockUpdateGallerySettings.mockReturnValue(deferred.promise)
    renderSettings()

    const toggle = await screen.findByRole('switch', { name: MAP_PUBLIC })
    fireEvent.click(toggle)

    expect(toggle).toBeEnabled()
    expect(toggle).toHaveAttribute('aria-busy', 'true')
    expect(toggle).not.toBeChecked()
    // The other controls are not held up by it.
    expect(screen.getByRole('switch', { name: SHOW_GEAR })).toHaveAttribute(
      'aria-busy',
      'false'
    )

    deferred.resolve({ ...baseSettings, mapPublic: false })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-busy', 'false'))
    expect(toggle).not.toBeChecked()
  })

  it('shows a retry when the settings fail to load', async () => {
    // The page reads the settings twice: once for its controls, once for the
    // hidden-locations editor.
    mockGetGallerySettings
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
    renderSettings()

    expect(
      await screen.findByText('Failed to load privacy settings.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('switch', { name: SHOW_GEAR })).toBeEnabled()
  })

  describe('hidden locations', () => {
    it('lists the saved locations from the gallery settings', async () => {
      renderSettings()

      expect(
        await screen.findByText('13.756300, 100.501800')
      ).toBeInTheDocument()
      expect(screen.getByText('Hide radius: 1km')).toBeInTheDocument()
    })

    it('saves the list as a hiddenLocations patch, snapped through the shared parser', async () => {
      renderSettings()
      await screen.findByText('13.756300, 100.501800')

      fireEvent.change(screen.getByLabelText('Latitude'), {
        target: { value: '52.1' }
      })
      fireEvent.change(screen.getByLabelText('Longitude'), {
        target: { value: '5.3' }
      })
      fireEvent.change(screen.getByLabelText('Hide Radius'), {
        target: { value: '200' }
      })
      fireEvent.click(
        screen.getByRole('button', { name: 'Save hidden locations' })
      )

      await waitFor(() =>
        expect(mockUpdateGallerySettings).toHaveBeenCalledWith({
          hiddenLocations: [
            { latitude: 13.7563, longitude: 100.5018, hideRadiusMeters: 1000 },
            { latitude: 52.1, longitude: 5.3, hideRadiusMeters: 200 }
          ]
        })
      )
      expect(
        await screen.findByText('Hidden locations saved.')
      ).toBeInTheDocument()
    })

    it('shows the server message when saving the locations is refused', async () => {
      renderSettings()
      await screen.findByText('13.756300, 100.501800')
      mockUpdateGallerySettings.mockRejectedValue(
        new Error('Too many hidden locations')
      )

      fireEvent.click(
        screen.getByRole('button', { name: 'Save hidden locations' })
      )

      expect(
        await screen.findByText('Too many hidden locations')
      ).toBeInTheDocument()
    })

    it('does not mix a hidden-locations save into the other controls', async () => {
      renderSettings()
      await screen.findByText('13.756300, 100.501800')

      fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

      await waitFor(() =>
        expect(mockUpdateGallerySettings).toHaveBeenCalledWith({
          hiddenLocations: []
        })
      )
      expect(screen.getByRole('switch', { name: MAP_PUBLIC })).toHaveAttribute(
        'aria-busy',
        'false'
      )
    })
  })
})
