import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  addGalleryAlbumItems,
  createGalleryAlbum,
  deleteGalleryAlbum,
  getGalleryAlbum,
  getGalleryAlbumItems,
  getGalleryAlbums,
  removeGalleryAlbumItems,
  updateGalleryAlbum
} from './galleryAlbums'

enableFetchMocks()

const ids = (count: number, start = 1) =>
  Array.from({ length: count }, (_, index) => String(start + index))

const bodyOf = (call: number) =>
  JSON.parse(String(fetchMock.mock.calls[call][1]?.body))

describe('gallery albums client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('getGalleryAlbums reads the owner list', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ albums: [], photoCount: 0 }))

    expect(await getGalleryAlbums()).toEqual({ albums: [], photoCount: 0 })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gallery/albums', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
  })

  it('getGalleryAlbum encodes the id and sends the options', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ album: { id: 'a/b' } }))

    await getGalleryAlbum('a/b', { limit: 20, sort: 'taken_asc' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/gallery/albums/a%2Fb?limit=20&sort=taken_asc',
      { method: 'GET', headers: { Accept: 'application/json' } }
    )
  })

  it('getGalleryAlbumItems sends the cursor, sort and species', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ items: [], nextMaxId: null }))

    await getGalleryAlbumItems('a1', {
      maxId: '10:2',
      limit: 30,
      sort: 'added_desc',
      subject: 'sci:alcedo atthis'
    })

    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      '/api/v1/gallery/albums/a1/items?max_id=10%3A2&limit=30&sort=added_desc&subject=sci%3Aalcedo+atthis'
    )
  })

  it('createGalleryAlbum maps the input to the request body', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ album: { id: 'a1' } }))

    await createGalleryAlbum({
      title: 'Kruger',
      description: null,
      visibility: 'private',
      sortOrder: 'taken_asc',
      mediaIds: ['1', '2']
    })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/gallery/albums')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(bodyOf(0)).toEqual({
      title: 'Kruger',
      description: null,
      visibility: 'private',
      sort_order: 'taken_asc',
      media_ids: ['1', '2']
    })
  })

  it('createGalleryAlbum leaves media_ids out when there are none', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ album: { id: 'a1' } }))

    await createGalleryAlbum({ title: 'Empty', mediaIds: [] })

    expect(bodyOf(0)).toEqual({ title: 'Empty' })
  })

  it('updateGalleryAlbum sends only the patch, snake-cased, and unwraps the album', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ album: { id: 'a1' } }))

    expect(
      await updateGalleryAlbum('a1', {
        coverMediaId: null,
        sortOrder: 'taken_desc'
      })
    ).toEqual({ id: 'a1' })
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PATCH')
    expect(bodyOf(0)).toEqual({
      cover_media_id: null,
      sort_order: 'taken_desc'
    })
  })

  it('deleteGalleryAlbum issues a DELETE', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ status: 'OK' }))

    await deleteGalleryAlbum('a1')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/gallery/albums/a1', {
      method: 'DELETE'
    })
  })

  it('addGalleryAlbumItems splits 250 ids into requests of 100 and merges the answers', async () => {
    const answer = (added: string[]) =>
      JSON.stringify({
        added,
        existing: [],
        skipped: [],
        album: { id: 'a1', itemCount: added.length }
      })
    fetchMock
      .mockResponseOnce(answer(ids(100)))
      .mockResponseOnce(answer(ids(100, 101)))
      .mockResponseOnce(answer(ids(50, 201)))

    const result = await addGalleryAlbumItems('a1', ids(250))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect([0, 1, 2].map((call) => bodyOf(call).media_ids.length)).toEqual([
      100, 100, 50
    ])
    expect(result.added).toHaveLength(250)
    expect(result.album).toMatchObject({ itemCount: 50 })
  })

  it('addGalleryAlbumItems stops at the first failed batch with the server message', async () => {
    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          added: ids(100),
          existing: [],
          skipped: [],
          album: {}
        })
      )
      .mockResponseOnce(
        JSON.stringify({ error: 'Too many photos in this album' }),
        {
          status: 422
        }
      )

    await expect(addGalleryAlbumItems('a1', ids(250))).rejects.toThrow(
      'Too many photos in this album'
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('addGalleryAlbumItems and removeGalleryAlbumItems refuse an empty list', async () => {
    await expect(addGalleryAlbumItems('a1', [])).rejects.toThrow(
      'Choose at least one photo.'
    )
    await expect(removeGalleryAlbumItems('a1', [])).rejects.toThrow(
      'Choose at least one photo.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('removeGalleryAlbumItems sends a DELETE body and returns what was removed', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ removed: ['1'], album: { id: 'a1', itemCount: 4 } })
    )

    expect(await removeGalleryAlbumItems('a1', ['1', '9'])).toEqual({
      removed: ['1'],
      album: { id: 'a1', itemCount: 4 }
    })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/gallery/albums/a1/items')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
    expect(bodyOf(0)).toEqual({ media_ids: ['1', '9'] })
  })

  it('surfaces the API error message', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not Found' }), {
      status: 404
    })

    await expect(getGalleryAlbum('missing')).rejects.toThrow('Not Found')
  })
})
