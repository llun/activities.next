import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  createGalleryGear,
  getGalleryGears,
  getGallerySettings,
  getMediaPublicDetails,
  updateGallerySettings
} from './gallery'

enableFetchMocks()

describe('gallery client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('getGalleryGears unwraps the gears envelope', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ gears: [{ id: 'g1' }] }))
    expect(await getGalleryGears()).toEqual([{ id: 'g1' }])
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gallery/gears', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
  })

  it('getGalleryGears throws the API error message', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'nope' }), {
      status: 500
    })
    await expect(getGalleryGears()).rejects.toThrow()
  })

  it('createGalleryGear posts JSON and unwraps the gear', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ gear: { id: 'g2' } }))
    const input = { kind: 'camera' as const, name: 'Sony A7' }
    expect(await createGalleryGear(input)).toEqual({ id: 'g2' })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gallery/gears', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    })
  })

  it('createGalleryGear rejects on failure', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'bad' }), {
      status: 422
    })
    await expect(
      createGalleryGear({ kind: 'lens', name: 'x' })
    ).rejects.toThrow()
  })

  it('getGallerySettings returns the flat settings', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ autoDescribe: true }))
    expect(await getGallerySettings()).toEqual({ autoDescribe: true })
  })

  it('updateGallerySettings sends only the given keys', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ autoDescribe: false }))
    await updateGallerySettings({ autoDescribe: false })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gallery/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoDescribe: false })
    })
  })

  it('updateGallerySettings rejects on failure', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'bad' }), {
      status: 400
    })
    await expect(updateGallerySettings({})).rejects.toThrow()
  })

  it('getMediaPublicDetails returns null on 404', async () => {
    fetchMock.mockResponseOnce('{}', { status: 404 })
    expect(await getMediaPublicDetails('m 1')).toBeNull()
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/v1/gallery/media/m%201/details'
    )
  })

  it('getMediaPublicDetails returns details and rejects on other errors', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ subjectName: 'Owl' }))
    expect(await getMediaPublicDetails('m1')).toEqual({ subjectName: 'Owl' })
    fetchMock.mockResponseOnce('{}', { status: 500 })
    await expect(getMediaPublicDetails('m1')).rejects.toThrow()
  })
})
