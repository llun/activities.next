/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { FitnessPrivacyLocationSettings } from './FitnessPrivacyLocationSettings'

describe('FitnessPrivacyLocationSettings', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('shows manual coordinate mode when mapbox token is missing', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        privacyLocations: []
      })
    } as Response)

    render(<FitnessPrivacyLocationSettings />)

    expect(
      await screen.findByText(
        'Mapbox access token is not configured. Enter latitude and longitude manually.'
      )
    ).toBeInTheDocument()

    expect(screen.getByLabelText('Latitude')).toBeInTheDocument()
    expect(screen.getByLabelText('Longitude')).toBeInTheDocument()

    const radiusSelect = screen.getByLabelText('Hide Radius')
    expect(radiusSelect).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '0m' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: '5m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '10m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '20m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '50m' })).toBeInTheDocument()

    expect(
      screen.getByText('No privacy locations added yet.')
    ).toBeInTheDocument()
  })

  it('adds a privacy location and saves the list payload', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input, init) => {
        const method = init?.method ?? 'GET'

        if (
          typeof input === 'string' &&
          input === '/api/v1/settings/fitness/general' &&
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
          input === '/api/v1/settings/fitness/general' &&
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

    render(<FitnessPrivacyLocationSettings />)

    await screen.findByText('No privacy locations added yet.')

    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: '13.7563' }
    })
    fireEvent.change(screen.getByLabelText('Longitude'), {
      target: { value: '100.5018' }
    })
    fireEvent.change(screen.getByLabelText('Hide Radius'), {
      target: { value: '20' }
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
        input === '/api/v1/settings/fitness/general' &&
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
          hideRadiusMeters: 20
        }
      ]
    })
  })

  it('persists clear all by posting an empty privacy locations list', async () => {
    const fetchMock = jest
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
                  hideRadiusMeters: 20
                }
              ]
            })
          } as Response
        }

        if (
          typeof input === 'string' &&
          input === '/api/v1/settings/fitness/general' &&
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

    render(<FitnessPrivacyLocationSettings />)

    await screen.findByText('13.756300, 100.501800')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))

    await waitFor(() => {
      expect(
        screen.getByText('Fitness privacy location settings cleared.')
      ).toBeInTheDocument()
    })

    const postBodies = fetchMock.mock.calls
      .filter(([, init]) => {
        return (init?.method ?? 'GET') === 'POST'
      })
      .map(([, init]) => JSON.parse(String(init?.body)))

    expect(postBodies.length).toBeGreaterThan(0)
    expect(postBodies[postBodies.length - 1]).toEqual({
      privacyLocations: []
    })
  })

  it('queues manual regeneration for old status map images', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input, init) => {
        const method = init?.method ?? 'GET'

        if (
          typeof input === 'string' &&
          input === '/api/v1/settings/fitness/general' &&
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
          input === '/api/v1/settings/fitness/general/regenerate-maps' &&
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

    render(<FitnessPrivacyLocationSettings />)

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
          input === '/api/v1/settings/fitness/general/regenerate-maps' &&
          (init?.method ?? 'GET') === 'POST'
        )
      })
    ).toBe(true)
  })
})
