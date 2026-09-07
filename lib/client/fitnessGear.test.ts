import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createFitnessGear,
  createFitnessGearComponent,
  deleteFitnessGear,
  deleteFitnessGearComponent,
  getFitnessGearActivities,
  getFitnessGearComponents,
  getFitnessGearList,
  refitFitnessGearComponent,
  retireFitnessGearComponent,
  setFitnessGearRetired,
  updateFitnessFileGear,
  updateFitnessGear,
  updateFitnessGearComponent
} from './fitnessGear'

enableFetchMocks()

describe('fitnessGear client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getFitnessGearList', () => {
    it('sends GET request to /api/v1/fitness/gear and returns gear list', async () => {
      const mockGear = [
        { id: 'gear-1', name: 'Road Bike', kind: 'bike' },
        { id: 'gear-2', name: 'Running Shoes', kind: 'shoes' }
      ]
      fetchMock.mockResponseOnce(JSON.stringify({ gear: mockGear }))

      const result = await getFitnessGearList()

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fitness/gear', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
      expect(result).toEqual(mockGear)
    })

    it('throws error with API error message on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ message: 'Database connection failed' }),
        { status: 500 }
      )

      await expect(getFitnessGearList()).rejects.toThrow(
        'Database connection failed'
      )
    })

    it('throws error with fallback message on empty error response', async () => {
      fetchMock.mockResponseOnce('', { status: 500, statusText: '' })

      await expect(getFitnessGearList()).rejects.toThrow('Failed to load gear.')
    })
  })

  describe('createFitnessGear', () => {
    it('sends POST request to /api/v1/fitness/gear with JSON payload', async () => {
      const payload = {
        kind: 'bike' as const,
        name: 'Tarmac SL7',
        brand: 'Specialized',
        model: 'Pro',
        bikeType: 'road',
        weightKilograms: 7.5,
        defaultSports: ['Ride', 'VirtualRide'],
        alertDistanceMeters: 5000000,
        notes: 'Race setup',
        productUrl: 'https://example.com/tarmac'
      }
      const mockCreated = { id: 'gear-new', ...payload }
      fetchMock.mockResponseOnce(JSON.stringify({ gear: mockCreated }))

      const result = await createFitnessGear(payload)

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fitness/gear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      expect(result).toEqual(mockCreated)
    })

    it('throws error with parsed API status on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ status: 'Invalid gear kind' }),
        { status: 422 }
      )

      await expect(
        createFitnessGear({ kind: 'bike', name: 'Bike' })
      ).rejects.toThrow('Invalid gear kind')
    })
  })

  describe('updateFitnessGear', () => {
    it('sends PATCH request to /api/v1/fitness/gear/:id with encoded id', async () => {
      const mockUpdated = { id: 'gear/123', name: 'Updated Name' }
      fetchMock.mockResponseOnce(JSON.stringify({ gear: mockUpdated }))

      const result = await updateFitnessGear('gear/123', {
        name: 'Updated Name'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear%2F123',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated Name' })
        }
      )
      expect(result).toEqual(mockUpdated)
    })

    it('supports null clearing of nullable fields', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ gear: { id: 'gear-1', name: 'Bike' } })
      )

      const clearingPayload = {
        brand: null,
        model: null,
        bikeType: null,
        weightKilograms: null,
        alertDistanceMeters: null,
        notes: null,
        productUrl: null
      }
      await updateFitnessGear('gear-1', clearingPayload)

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fitness/gear/gear-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clearingPayload)
      })
    })

    it('throws error on failure', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Gear not found' }), {
        status: 404
      })

      await expect(
        updateFitnessGear('gear-1', { name: 'New' })
      ).rejects.toThrow('Gear not found')
    })
  })

  describe('deleteFitnessGear', () => {
    it('sends DELETE request to /api/v1/fitness/gear/:id', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      await deleteFitnessGear('gear-abc')

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fitness/gear/gear-abc', {
        method: 'DELETE'
      })
    })

    it('throws error on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Cannot delete gear with activities' }),
        { status: 409 }
      )

      await expect(deleteFitnessGear('gear-abc')).rejects.toThrow(
        'Cannot delete gear with activities'
      )
    })
  })

  describe('setFitnessGearRetired', () => {
    it('sends POST to /api/v1/fitness/gear/:id/retire with { retired: true }', async () => {
      const mockGear = { id: 'gear-1', retired: true }
      fetchMock.mockResponseOnce(JSON.stringify({ gear: mockGear }))

      const result = await setFitnessGearRetired('gear-1', true)

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/retire',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retired: true })
        }
      )
      expect(result).toEqual(mockGear)
    })

    it('sends POST with { retired: false } to unretire', async () => {
      const mockGear = { id: 'gear-1', retired: false }
      fetchMock.mockResponseOnce(JSON.stringify({ gear: mockGear }))

      const result = await setFitnessGearRetired('gear-1', false)

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/retire',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retired: false })
        }
      )
      expect(result).toEqual(mockGear)
    })

    it('uses fallback "Failed to retire gear." when retired is true', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(setFitnessGearRetired('gear-1', true)).rejects.toThrow(
        'Failed to retire gear.'
      )
    })

    it('uses fallback "Failed to unretire gear." when retired is false', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(setFitnessGearRetired('gear-1', false)).rejects.toThrow(
        'Failed to unretire gear.'
      )
    })
  })

  describe('getFitnessGearActivities', () => {
    it('sends GET without query params when limit and offset are omitted', async () => {
      const mockPage = { statuses: [], hasMore: false, nextOffset: 0 }
      fetchMock.mockResponseOnce(JSON.stringify(mockPage))

      const result = await getFitnessGearActivities('gear-1')

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/activities',
        { method: 'GET', headers: { Accept: 'application/json' } }
      )
      expect(result).toEqual(mockPage)
    })

    it('sends GET with limit and offset query parameters', async () => {
      const mockPage = { statuses: [], hasMore: true, nextOffset: 20 }
      fetchMock.mockResponseOnce(JSON.stringify(mockPage))

      const result = await getFitnessGearActivities('gear-1', {
        limit: 10,
        offset: 10
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/activities?limit=10&offset=10',
        { method: 'GET', headers: { Accept: 'application/json' } }
      )
      expect(result).toEqual(mockPage)
    })

    it('throws error on failure', async () => {
      fetchMock.mockResponseOnce('Server error', { status: 500 })

      await expect(getFitnessGearActivities('gear-1')).rejects.toThrow(
        'Server error'
      )
    })
  })

  describe('getFitnessGearComponents', () => {
    it('sends GET to /api/v1/fitness/gear/:id/components', async () => {
      const mockComponents = [{ id: 'comp-1', componentType: 'Chain' }]
      fetchMock.mockResponseOnce(JSON.stringify({ components: mockComponents }))

      const result = await getFitnessGearComponents('gear-1')

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/components',
        { method: 'GET', headers: { Accept: 'application/json' } }
      )
      expect(result).toEqual(mockComponents)
    })

    it('throws error on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(getFitnessGearComponents('gear-1')).rejects.toThrow(
        'Failed to load components.'
      )
    })
  })

  describe('createFitnessGearComponent', () => {
    it('sends POST to /api/v1/fitness/gear/:id/components with payload', async () => {
      const payload = {
        componentType: 'Chain',
        brand: 'Shimano',
        model: 'CN-M8100',
        addedAt: 1700000000000,
        removedAt: null,
        serviceDistanceMeters: 500000
      }
      const mockComponent = { id: 'comp-1', ...payload }
      fetchMock.mockResponseOnce(JSON.stringify({ component: mockComponent }))

      const result = await createFitnessGearComponent('gear-1', payload)

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/components',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }
      )
      expect(result).toEqual(mockComponent)
    })

    it('throws error on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Invalid component' }),
        { status: 400 }
      )

      await expect(
        createFitnessGearComponent('gear-1', { componentType: 'Tire' })
      ).rejects.toThrow('Invalid component')
    })
  })

  describe('updateFitnessGearComponent', () => {
    it('sends PATCH to /api/v1/fitness/gear/:id/components/:componentId', async () => {
      const mockComponent = { id: 'comp-1', brand: 'Continental' }
      fetchMock.mockResponseOnce(JSON.stringify({ component: mockComponent }))

      const result = await updateFitnessGearComponent('gear-1', 'comp-1', {
        brand: 'Continental'
      })

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/components/comp-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand: 'Continental' })
        }
      )
      expect(result).toEqual(mockComponent)
    })

    it('supports null clearing of nullable component fields', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ component: { id: 'comp-1' } })
      )

      const clearingPayload = {
        brand: null,
        model: null,
        addedAt: null,
        removedAt: null,
        serviceDistanceMeters: null
      }
      await updateFitnessGearComponent('gear-1', 'comp-1', clearingPayload)

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/components/comp-1',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(clearingPayload)
        }
      )
    })

    it('throws error on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(
        updateFitnessGearComponent('gear-1', 'comp-1', { brand: 'SRAM' })
      ).rejects.toThrow('Failed to save component.')
    })
  })

  describe('deleteFitnessGearComponent', () => {
    it('sends DELETE to /api/v1/fitness/gear/:id/components/:componentId', async () => {
      fetchMock.mockResponseOnce('', { status: 200 })

      await deleteFitnessGearComponent('gear-1', 'comp-1')

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/components/comp-1',
        { method: 'DELETE' }
      )
    })

    it('throws error on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(
        deleteFitnessGearComponent('gear-1', 'comp-1')
      ).rejects.toThrow('Failed to delete component.')
    })
  })

  describe('retireFitnessGearComponent', () => {
    it('sends POST to /api/v1/fitness/gear/:id/components/:componentId/retire', async () => {
      const mockComponent = { id: 'comp-1', removedAt: 1700000000000 }
      fetchMock.mockResponseOnce(JSON.stringify({ component: mockComponent }))

      const result = await retireFitnessGearComponent('gear-1', 'comp-1')

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/components/comp-1/retire',
        { method: 'POST' }
      )
      expect(result).toEqual(mockComponent)
    })

    it('throws error on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(
        retireFitnessGearComponent('gear-1', 'comp-1')
      ).rejects.toThrow('Failed to retire component.')
    })
  })

  describe('refitFitnessGearComponent', () => {
    it('sends POST to /api/v1/fitness/gear/:id/components/:componentId/refit', async () => {
      const mockComponent = { id: 'comp-1', addedAt: 1700000000000 }
      fetchMock.mockResponseOnce(JSON.stringify({ component: mockComponent }))

      const result = await refitFitnessGearComponent('gear-1', 'comp-1')

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/fitness/gear/gear-1/components/comp-1/refit',
        { method: 'POST' }
      )
      expect(result).toEqual(mockComponent)
    })

    it('throws error on failure', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(
        refitFitnessGearComponent('gear-1', 'comp-1')
      ).rejects.toThrow('Failed to refit component.')
    })
  })

  describe('updateFitnessFileGear', () => {
    it('sends PATCH to /api/v1/fitness-files/:id with gearId', async () => {
      const mockResponse = { id: 'file-1', gearId: 'gear-1' }
      fetchMock.mockResponseOnce(JSON.stringify(mockResponse))

      const result = await updateFitnessFileGear('file-1', 'gear-1')

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fitness-files/file-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gearId: 'gear-1' })
      })
      expect(result).toEqual(mockResponse)
    })

    it('supports clearing gearId by sending null', async () => {
      const mockResponse = { id: 'file-1', gearId: null }
      fetchMock.mockResponseOnce(JSON.stringify(mockResponse))

      const result = await updateFitnessFileGear('file-1', null)

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/fitness-files/file-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gearId: null })
      })
      expect(result).toEqual(mockResponse)
    })

    it('throws error on failure', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'Activity not found' }),
        { status: 404 }
      )

      await expect(updateFitnessFileGear('file-1', 'gear-1')).rejects.toThrow(
        'Activity not found'
      )
    })
  })
})
