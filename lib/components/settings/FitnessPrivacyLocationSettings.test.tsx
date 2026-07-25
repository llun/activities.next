/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { loadMaplibreModule } from '@/lib/utils/maplibre'

import { FitnessPrivacyLocationSettings } from './FitnessPrivacyLocationSettings'

// The GL loaders never resolve here, so the picker stays in its initializing
// state (no real CDN/Mapbox/MapLibre script is injected in jsdom).
vi.mock('@/lib/utils/mapbox', () => ({
  loadMapboxModule: vi.fn(() => new Promise(() => {}))
}))
vi.mock('@/lib/utils/maplibre', () => ({
  loadMaplibreModule: vi.fn(() => new Promise(() => {})),
  OPENFREEMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/bright',
  OPENFREEMAP_HEATMAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron'
}))

describe('FitnessPrivacyLocationSettings', () => {
  interface BrowserCurrentLocationOptions {
    maximumAge?: number
  }

  const originalGeolocation = global.navigator.geolocation

  afterEach(() => {
    vi.restoreAllMocks()
    // `restoreAllMocks` does not reset an implementation set on a vi.fn() from
    // a module mock factory, so a test that makes the GL loader resolve would
    // otherwise leak a live map into every later test in this file.
    vi.mocked(loadMaplibreModule).mockImplementation(
      () => new Promise(() => {})
    )
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: originalGeolocation
    })
  })

  it('renders the map picker alongside the manual coordinate fields', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        privacyLocations: []
      })
    } as Response)

    render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

    // Every provider now renders an interactive picker — the keyless OSM map
    // included — so the manual fields are the fallback, not the default.
    expect(
      await screen.findByText(
        'Click the map to set coordinates for a location you want to add.'
      )
    ).toBeInTheDocument()

    expect(screen.getByLabelText('Latitude')).toBeInTheDocument()
    expect(screen.getByLabelText('Longitude')).toBeInTheDocument()

    const radiusSelect = screen.getByLabelText('Hide Radius')
    expect(radiusSelect).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '0m' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '50m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '100m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '200m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '500m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '1km' })).toBeInTheDocument()

    expect(
      screen.getByText('No privacy locations added yet.')
    ).toBeInTheDocument()
  })

  it('adds a privacy location and saves the list payload', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async (input, init) => {
        const method = init?.method ?? 'GET'

        if (
          typeof input === 'string' &&
          input === '/api/v1/fitness/general' &&
          method === 'GET'
        ) {
          return {
            ok: true,
            json: async () => ({
              privacyLocations: []
            })
          } as Response
        }

        if (
          typeof input === 'string' &&
          input === '/api/v1/fitness/general' &&
          method === 'POST'
        ) {
          const requestBody = JSON.parse(String(init?.body)) as {
            privacyLocations: Array<{
              latitude: number
              longitude: number
              hideRadiusMeters: number
            }>
          }

          return {
            ok: true,
            json: async () => ({
              success: true,
              privacyLocations: requestBody.privacyLocations
            })
          } as Response
        }

        throw new Error('Unexpected fetch call')
      })

    render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

    await screen.findByText('No privacy locations added yet.')

    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: '13.7563' }
    })
    fireEvent.change(screen.getByLabelText('Longitude'), {
      target: { value: '100.5018' }
    })
    fireEvent.change(screen.getByLabelText('Hide Radius'), {
      target: { value: '200' }
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Add location to list' })
    )

    await waitFor(() => {
      expect(screen.getByText('13.756300, 100.501800')).toBeInTheDocument()
      expect(
        screen.getByText(
          'Privacy location added to list. Save settings to apply.'
        )
      ).toBeInTheDocument()
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Save privacy locations' })
    )

    await waitFor(() => {
      expect(
        screen.getByText('Fitness privacy location settings saved.')
      ).toBeInTheDocument()
    })

    const postCall = fetchMock.mock.calls.find(([input, init]) => {
      return (
        input === '/api/v1/fitness/general' &&
        (init?.method ?? 'GET') === 'POST'
      )
    })
    expect(postCall).toBeDefined()

    const requestBody = JSON.parse(String(postCall?.[1]?.body))
    expect(requestBody).toEqual({
      privacyLocations: [
        {
          latitude: 13.7563,
          longitude: 100.5018,
          hideRadiusMeters: 200
        }
      ]
    })
  })

  it('fills coordinates from browser current location', async () => {
    const getCurrentPosition = vi.fn(
      (success: (position: GeolocationPosition) => void) => {
        success({
          coords: {
            latitude: 52.010044,
            longitude: 5.678277
          }
        } as GeolocationPosition)
      }
    )
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition
      }
    })

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        privacyLocations: []
      })
    } as Response)

    render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

    const useCurrentLocationButton = await screen.findByRole('button', {
      name: 'Use current location'
    })
    await waitFor(() => {
      expect(useCurrentLocationButton).not.toBeDisabled()
    })
    fireEvent.click(useCurrentLocationButton)

    await waitFor(() => {
      expect(screen.getByDisplayValue('52.010044')).toBeInTheDocument()
      expect(screen.getByDisplayValue('5.678277')).toBeInTheDocument()
      expect(
        screen.getByText('Location updated from your browser.')
      ).toBeInTheDocument()
    })
    expect(getCurrentPosition).toHaveBeenCalled()
  })

  it('retries with fallback geolocation options when first lookup fails', async () => {
    const getCurrentPosition = vi.fn(
      (
        success: (position: GeolocationPosition) => void,
        error?: (error: GeolocationPositionError) => void,
        options?: BrowserCurrentLocationOptions
      ) => {
        if (options?.maximumAge === 0) {
          error?.({
            code: 3,
            message: 'Timeout'
          } as GeolocationPositionError)
          return
        }

        success({
          coords: {
            latitude: 46.044945,
            longitude: 14.506012
          }
        } as GeolocationPosition)
      }
    )
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition
      }
    })

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        privacyLocations: []
      })
    } as Response)

    render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

    const useCurrentLocationButton = await screen.findByRole('button', {
      name: 'Use current location'
    })
    await waitFor(() => {
      expect(useCurrentLocationButton).not.toBeDisabled()
    })
    fireEvent.click(useCurrentLocationButton)

    await waitFor(() => {
      expect(screen.getByDisplayValue('46.044945')).toBeInTheDocument()
      expect(screen.getByDisplayValue('14.506012')).toBeInTheDocument()
    })
    expect(getCurrentPosition).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      description: 'renders a metre radius in the saved list',
      stored: 200,
      label: 'Hide radius: 200m'
    },
    {
      description: 'renders the 1km radius in the saved list',
      stored: 1000,
      label: 'Hide radius: 1km'
    },
    {
      description: 'renders a legacy radius snapped up to the 50m floor',
      stored: 20,
      label: 'Hide radius: 50m'
    }
  ])(
    '$description',
    async ({ stored, label }: { stored: number; label: string }) => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          privacyLocations: [
            {
              latitude: 13.7563,
              longitude: 100.5018,
              hideRadiusMeters: stored
            }
          ]
        })
      } as Response)

      render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

      expect(
        await screen.findByText(label, { collapseWhitespace: true })
      ).toBeInTheDocument()
    }
  )

  it('persists clear all by posting an empty privacy locations list', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async (input, init) => {
        const method = init?.method ?? 'GET'

        if (method === 'GET') {
          return {
            ok: true,
            json: async () => ({
              privacyLocations: [
                {
                  latitude: 13.7563,
                  longitude: 100.5018,
                  hideRadiusMeters: 200
                }
              ]
            })
          } as Response
        }

        if (
          typeof input === 'string' &&
          input === '/api/v1/fitness/general' &&
          method === 'POST'
        ) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              privacyLocations: []
            })
          } as Response
        }

        throw new Error('Unexpected fetch call')
      })

    render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

    await screen.findByText('13.756300, 100.501800')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

    await waitFor(() => {
      expect(
        screen.getByText('Fitness privacy location settings cleared.')
      ).toBeInTheDocument()
    })

    const postBodies = fetchMock.mock.calls
      .filter(([input, init]) => {
        return (
          input === '/api/v1/fitness/general' &&
          (init?.method ?? 'GET') === 'POST'
        )
      })
      .map(([, init]) => JSON.parse(String(init?.body)))

    expect(postBodies.length).toBeGreaterThan(0)
    expect(postBodies[postBodies.length - 1]).toEqual({
      privacyLocations: []
    })
  })

  it('updates coordinates from browser location after clearing all', async () => {
    const getCurrentPosition = vi.fn(
      (success: (position: GeolocationPosition) => void) => {
        success({
          coords: {
            latitude: 46.044945,
            longitude: 14.506012
          }
        } as GeolocationPosition)
      }
    )
    Object.defineProperty(global.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition
      }
    })

    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const method = init?.method ?? 'GET'

      if (
        typeof input === 'string' &&
        input === '/api/v1/fitness/general' &&
        method === 'GET'
      ) {
        return {
          ok: true,
          json: async () => ({
            privacyLocations: [
              {
                latitude: 13.7563,
                longitude: 100.5018,
                hideRadiusMeters: 200
              }
            ]
          })
        } as Response
      }

      if (
        typeof input === 'string' &&
        input === '/api/v1/fitness/general' &&
        method === 'POST'
      ) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            privacyLocations: []
          })
        } as Response
      }

      throw new Error('Unexpected fetch call')
    })

    render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

    await screen.findByText('13.756300, 100.501800')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('46.044945')).toBeInTheDocument()
      expect(screen.getByDisplayValue('14.506012')).toBeInTheDocument()
    })
    expect(getCurrentPosition).toHaveBeenCalled()
  })

  it('does not re-add a removed location when saving', async () => {
    const postBodies: Array<{
      privacyLocations: Array<{
        latitude: number
        longitude: number
        hideRadiusMeters: number
      }>
    }> = []

    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const method = init?.method ?? 'GET'

      if (
        typeof input === 'string' &&
        input === '/api/v1/fitness/general' &&
        method === 'GET'
      ) {
        return {
          ok: true,
          json: async () => ({
            privacyLocations: [
              {
                latitude: 13.7563,
                longitude: 100.5018,
                hideRadiusMeters: 200
              }
            ]
          })
        } as Response
      }

      if (
        typeof input === 'string' &&
        input === '/api/v1/fitness/general' &&
        method === 'POST'
      ) {
        const requestBody = JSON.parse(String(init?.body)) as {
          privacyLocations: Array<{
            latitude: number
            longitude: number
            hideRadiusMeters: number
          }>
        }
        postBodies.push(requestBody)

        return {
          ok: true,
          json: async () => ({
            success: true,
            privacyLocations: requestBody.privacyLocations
          })
        } as Response
      }

      throw new Error('Unexpected fetch call')
    })

    render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

    await screen.findByText('13.756300, 100.501800')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Save privacy locations' })
    )

    await waitFor(() => {
      expect(
        screen.getByText('Fitness privacy location settings saved.')
      ).toBeInTheDocument()
    })

    expect(postBodies.length).toBeGreaterThan(0)
    expect(postBodies[postBodies.length - 1]).toEqual({
      privacyLocations: []
    })
  })

  it('queues manual regeneration for old status map images', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockImplementation(async (input, init) => {
        const method = init?.method ?? 'GET'

        if (
          typeof input === 'string' &&
          input === '/api/v1/fitness/general' &&
          method === 'GET'
        ) {
          return {
            ok: true,
            json: async () => ({
              privacyLocations: []
            })
          } as Response
        }

        if (
          typeof input === 'string' &&
          input === '/api/v1/fitness/general/regenerate-maps' &&
          method === 'POST'
        ) {
          return {
            ok: true,
            json: async () => ({
              success: true,
              queuedCount: 3
            })
          } as Response
        }

        throw new Error('Unexpected fetch call')
      })

    render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

    const regenerateButton = await screen.findByRole('button', {
      name: 'Regenerate maps for old statuses'
    })
    await waitFor(() => {
      expect(regenerateButton).not.toBeDisabled()
    })

    fireEvent.click(regenerateButton)

    await waitFor(() => {
      expect(
        screen.getByText('Queued map regeneration for 3 old statuses.')
      ).toBeInTheDocument()
    })

    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        return (
          input === '/api/v1/fitness/general/regenerate-maps' &&
          (init?.method ?? 'GET') === 'POST'
        )
      })
    ).toBe(true)
  })

  describe('when the settings fail to load', () => {
    const failingFetch = () =>
      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const method = init?.method ?? 'GET'
        if (method === 'GET') {
          return { ok: false, json: async () => ({}) } as Response
        }
        throw new Error('Unexpected write while settings are unloaded')
      })

    it('disables save and clear so a failed load cannot destroy saved zones', async () => {
      failingFetch()

      render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

      expect(
        await screen.findByText(/Failed to load your saved privacy locations/)
      ).toBeInTheDocument()
      // A save replaces the whole stored list, so saving from an empty form
      // after a failed load would wipe every zone the actor configured.
      expect(
        screen.getByRole('button', { name: 'Save privacy locations' })
      ).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
    })

    it('does not prefill coordinates from the browser after a failed load', async () => {
      const getCurrentPosition = vi.fn(
        (success: (position: GeolocationPosition) => void) => {
          success({
            coords: { latitude: 52.010044, longitude: 5.678277 }
          } as GeolocationPosition)
        }
      )
      Object.defineProperty(global.navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition }
      })
      failingFetch()
      // The auto-locate effect is gated on `isMapReady`, so the map has to
      // actually finish loading or this test would pass for the wrong reason.
      vi.mocked(loadMaplibreModule).mockResolvedValue({
        Map: vi.fn(function MapStub() {
          return {
            addSource: vi.fn(),
            addLayer: vi.fn(),
            getSource: vi.fn(),
            once: (_event: 'load', listener: () => void) => listener(),
            on: vi.fn(),
            flyTo: vi.fn(),
            remove: vi.fn()
          }
        })
      } as never)

      render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

      await screen.findByText(/Failed to load your saved privacy locations/)
      await waitFor(() => expect(loadMaplibreModule).toHaveBeenCalled())

      // The map's own initial-view lookup also calls geolocation, so assert on
      // the form fields: prefilling them would dress an empty form up as a
      // configured one. Give the effect a tick to run before asserting.
      await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled())
      expect(screen.queryByDisplayValue('52.010044')).not.toBeInTheDocument()
      expect(screen.getByLabelText('Latitude')).toHaveValue('')
    })

    it('disables the whole editing surface, not just save', async () => {
      failingFetch()

      render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

      await screen.findByText(/Failed to load your saved privacy locations/)

      // Leaving these enabled lets the user build a list against an empty form
      // and be told to "save settings to apply" against a disabled Save.
      expect(
        screen.getByRole('button', { name: 'Add location to list' })
      ).toBeDisabled()
      expect(
        screen.getByRole('button', { name: 'Use current location' })
      ).toBeDisabled()
      expect(screen.getByLabelText('Latitude')).toBeDisabled()
      expect(screen.getByLabelText('Hide Radius')).toBeDisabled()
    })

    it('keeps explaining why saving is disabled after an unrelated action', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return { ok: false, json: async () => ({}) } as Response
        }
        return {
          ok: false,
          json: async () => ({ error: 'Regeneration unavailable' })
        } as Response
      })

      render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

      expect(
        await screen.findByText(/Failed to load your saved privacy locations/)
      ).toBeInTheDocument()

      // Regenerate is deliberately not gated, and its handler clears the shared
      // `error` slot — so the guard's explanation must not live there.
      fireEvent.click(
        screen.getByRole('button', { name: 'Regenerate maps for old statuses' })
      )

      // Await the handler settling so no in-flight POST leaks into the next
      // test's fetch spy.
      expect(
        await screen.findByText('Regeneration unavailable')
      ).toBeInTheDocument()
      expect(
        screen.getByText(/Failed to load your saved privacy locations/)
      ).toBeInTheDocument()
    })

    it('treats an unrecognised 200 body as a failed load', async () => {
      // A bare cast would accept this as "loaded with no zones", and the next
      // save would replace the stored list with an empty one.
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ unexpected: true })
      } as Response)

      render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

      expect(
        await screen.findByText(/Failed to load your saved privacy locations/)
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Save privacy locations' })
      ).toBeDisabled()
    })

    it('recovers the saved zones when the retry succeeds', async () => {
      let shouldFail = true
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        if (shouldFail) {
          shouldFail = false
          return { ok: false, json: async () => ({}) } as Response
        }
        return {
          ok: true,
          json: async () => ({
            privacyLocations: [
              {
                latitude: 13.7563,
                longitude: 100.5018,
                hideRadiusMeters: 200
              }
            ]
          })
        } as Response
      })

      render(<FitnessPrivacyLocationSettings mapProvider={{ type: 'osm' }} />)

      fireEvent.click(
        await screen.findByRole('button', { name: 'Retry loading' })
      )

      expect(
        await screen.findByText('Hide radius: 200m', {
          collapseWhitespace: true
        })
      ).toBeInTheDocument()
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Save privacy locations' })
        ).not.toBeDisabled()
      )
    })
  })
})
