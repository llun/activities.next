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
        privacyHomeLatitude: null,
        privacyHomeLongitude: null,
        privacyHideRadiusMeters: 0
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
    expect(screen.getByRole('option', { name: '0m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '5m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '10m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '20m' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '50m' })).toBeInTheDocument()
  })

  it('persists clear action by posting null coordinates and zero radius', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (input, init) => {
        const method = init?.method ?? 'GET'

        if (method === 'GET') {
          return {
            ok: true,
            json: async () => ({
              privacyHomeLatitude: 13.7563,
              privacyHomeLongitude: 100.5018,
              privacyHideRadiusMeters: 20
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
              privacyHomeLatitude: null,
              privacyHomeLongitude: null,
              privacyHideRadiusMeters: 0
            })
          } as Response
        }

        throw new Error('Unexpected fetch call')
      })

    render(<FitnessPrivacyLocationSettings />)

    await screen.findByDisplayValue('13.756300')
    await screen.findByDisplayValue('100.501800')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => {
      expect(
        screen.getByText('Fitness privacy location settings cleared.')
      ).toBeInTheDocument()
    })

    const postCall = fetchMock.mock.calls.find(([, init]) => {
      return (init?.method ?? 'GET') === 'POST'
    })
    expect(postCall).toBeDefined()

    const requestBody = JSON.parse(String(postCall?.[1]?.body))
    expect(requestBody).toEqual({
      privacyHomeLatitude: null,
      privacyHomeLongitude: null,
      privacyHideRadiusMeters: 0
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
              privacyHomeLatitude: null,
              privacyHomeLongitude: null,
              privacyHideRadiusMeters: 0
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
