import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  deleteGalleryGear,
  getGalleryGear,
  getGalleryGearsWithUsage,
  setGalleryGearRetired,
  updateGalleryGear
} from './galleryGear'

enableFetchMocks()

describe('gallery gear client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('getGalleryGearsWithUsage asks for usage and unwraps the gears', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ gears: [{ id: 'g1' }] }))

    expect(await getGalleryGearsWithUsage()).toEqual([{ id: 'g1' }])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/gallery/gears?include=usage',
      {
        method: 'GET',
        headers: { Accept: 'application/json' }
      }
    )
  })

  it('getGalleryGear unwraps the gear and encodes the id', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ gear: { id: 'a/b' } }))

    expect(await getGalleryGear('a/b')).toEqual({ id: 'a/b' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gallery/gears/a%2Fb', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
  })

  it('updateGalleryGear sends only the patch', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ gear: { id: 'g1' } }))

    expect(await updateGalleryGear('g1', { name: 'New', brand: null })).toEqual(
      { id: 'g1' }
    )
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gallery/gears/g1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New', brand: null })
    })
  })

  it('deleteGalleryGear issues a DELETE', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ status: 'OK' }))

    await deleteGalleryGear('g1')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gallery/gears/g1', {
      method: 'DELETE'
    })
  })

  it('setGalleryGearRetired posts the flag', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ gear: { id: 'g1' } }))

    expect(await setGalleryGearRetired('g1', true)).toEqual({ id: 'g1' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gallery/gears/g1/retire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retired: true })
    })
  })

  it.each([
    ['getGalleryGearsWithUsage', () => getGalleryGearsWithUsage()],
    ['getGalleryGear', () => getGalleryGear('g1')],
    ['updateGalleryGear', () => updateGalleryGear('g1', { name: 'x' })],
    ['deleteGalleryGear', () => deleteGalleryGear('g1')],
    ['setGalleryGearRetired', () => setGalleryGearRetired('g1', false)]
  ])('%s throws the API error message', async (_, call) => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not found' }), {
      status: 404
    })

    await expect(call()).rejects.toThrow('Not found')
  })
})
