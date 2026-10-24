import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  GalleryAlbumAddError,
  addGalleryAlbumItems,
  createGalleryAlbum,
  deleteGalleryAlbum,
  getAccountGalleryAlbum,
  getAccountGalleryAlbums,
  getGalleryAlbum,
  getGalleryAlbumItems,
  getGalleryAlbumMembership,
  getGalleryAlbums,
  getMediaAlbums,
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
      limit: 24,
      sort: 'added_desc',
      subject: 'sci:alcedo atthis'
    })

    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      '/api/v1/gallery/albums/a1/items?max_id=10%3A2&limit=24&sort=added_desc&subject=sci%3Aalcedo+atthis'
    )
  })

  it('createGalleryAlbum maps the input to the request body', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ album: { id: 'a1' } }))

    await createGalleryAlbum({
      title: 'Kruger',
      description: null,
      visibility: 'private',
      sortOrder: 'taken_asc',
      coverMediaId: '2',
      mediaIds: ['1', '2']
    })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/gallery/albums')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(bodyOf(0)).toEqual({
      title: 'Kruger',
      description: null,
      visibility: 'private',
      sort_order: 'taken_asc',
      cover_media_id: '2',
      media_ids: ['1', '2']
    })
  })

  it('createGalleryAlbum leaves media_ids and cover_media_id out when absent', async () => {
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

  it('addGalleryAlbumItems reports what the earlier batches added and that the album is full', async () => {
    fetchMock
      .mockResponseOnce(
        JSON.stringify({
          added: ids(100),
          existing: ['500'],
          skipped: ['600'],
          album: { id: 'a1', itemCount: 100 }
        })
      )
      .mockResponseOnce(
        JSON.stringify({ error: 'Too many photos in this album' }),
        { status: 422 }
      )

    const error = await addGalleryAlbumItems('a1', ids(250)).catch(
      (caught) => caught
    )

    expect(error).toBeInstanceOf(GalleryAlbumAddError)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      status: 422,
      isFull: true,
      result: { existing: ['500'], skipped: ['600'] }
    })
    expect(error.result.added).toHaveLength(100)
  })

  it('addGalleryAlbumItems has no result when the first batch fails, and is not "full" for other errors', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ error: 'Too many requests' }), {
      status: 429
    })

    const error = await addGalleryAlbumItems('a1', ids(3)).catch(
      (caught) => caught
    )

    expect(error).toMatchObject({
      message: 'Too many requests',
      status: 429,
      isFull: false,
      result: null
    })
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
  describe('reading another account’s public albums', () => {
    const ACCOUNT = 'https://llun.test/users/ann'

    it('getAccountGalleryAlbums reads the account list, with the account id in the path', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ albums: [], photoCount: 0 }))

      expect(await getAccountGalleryAlbums(ACCOUNT)).toEqual({
        albums: [],
        photoCount: 0
      })
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/accounts/llun.test:users:ann/gallery/albums',
        { method: 'GET', headers: { Accept: 'application/json' } }
      )
    })

    it('getAccountGalleryAlbums leaves a public id as it is', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ albums: [], photoCount: 0 }))

      await getAccountGalleryAlbums('0194f6a1-7b2c-7d3e-8f4a-5b6c7d8e9f0a')

      expect(String(fetchMock.mock.calls[0][0])).toBe(
        '/api/v1/accounts/0194f6a1-7b2c-7d3e-8f4a-5b6c7d8e9f0a/gallery/albums'
      )
    })

    it('getAccountGalleryAlbum encodes the album id and sends the paging options', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ album: { id: 'a/b' } }))

      await getAccountGalleryAlbum(ACCOUNT, 'a/b', {
        maxId: '10:2',
        limit: 24,
        sort: 'taken_asc',
        subject: 'sci:alcedo atthis'
      })

      expect(String(fetchMock.mock.calls[0][0])).toBe(
        '/api/v1/accounts/llun.test:users:ann/gallery/albums/a%2Fb?max_id=10%3A2&limit=24&sort=taken_asc&subject=sci%3Aalcedo+atthis'
      )
      expect(fetchMock.mock.calls[0][1]).toEqual({
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })

    it('getAccountGalleryAlbum sends no query without options', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ album: { id: 'a1' } }))

      await getAccountGalleryAlbum(ACCOUNT, 'a1')

      expect(String(fetchMock.mock.calls[0][0])).toBe(
        '/api/v1/accounts/llun.test:users:ann/gallery/albums/a1'
      )
    })

    it('rejects with the API message, or a plain one when there is none', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not Found' }), {
        status: 404
      })
      await expect(getAccountGalleryAlbum(ACCOUNT, 'a1')).rejects.toThrow(
        'Not Found'
      )

      fetchMock.mockResponseOnce('', { status: 500 })
      await expect(getAccountGalleryAlbum(ACCOUNT, 'a1')).rejects.toThrow(
        'Failed to load the album.'
      )

      fetchMock.mockResponseOnce('', { status: 500 })
      await expect(getAccountGalleryAlbums(ACCOUNT)).rejects.toThrow(
        'Failed to load albums.'
      )
    })
  })

  describe('getMediaAlbums', () => {
    it('reads the albums of a photo, encoding the id', async () => {
      const body = {
        albums: [
          { id: 'a1', title: 'Kruger', visibility: 'public', itemCount: 3 }
        ],
        albumIds: ['a1'],
        addable: true
      }
      fetchMock.mockResponseOnce(JSON.stringify(body))

      expect(await getMediaAlbums('12/3')).toEqual(body)
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/media/12%2F3/albums', {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
    })

    it('is null for a photo that is not the caller (404)', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not Found' }), {
        status: 404
      })

      expect(await getMediaAlbums('9')).toBeNull()
    })

    it('throws the server message for any other failure', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Boom' }), {
        status: 500
      })

      await expect(getMediaAlbums('9')).rejects.toThrow('Boom')
    })
  })

  describe('getGalleryAlbumMembership', () => {
    it('de-duplicates, splits 150 ids into two POSTs of 100 and 50, and merges album ids without duplicates', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          albums: [
            { id: 'a1', mediaIds: ['1', '2'] },
            { id: 'a2', mediaIds: ['3'] }
          ]
        })
      )
      fetchMock.mockResponseOnce(
        JSON.stringify({
          albums: [
            { id: 'a1', mediaIds: ['101'] },
            { id: 'a3', mediaIds: ['102'] }
          ]
        })
      )

      const input = [...ids(150), '1', '2', '100']
      const result = await getGalleryAlbumMembership(input)

      expect(fetchMock).toHaveBeenCalledTimes(2)

      expect(fetchMock.mock.calls[0][0]).toBe(
        '/api/v1/gallery/albums/membership'
      )
      expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
      expect(bodyOf(0)).toEqual({ media_ids: ids(100) })

      expect(fetchMock.mock.calls[1][0]).toBe(
        '/api/v1/gallery/albums/membership'
      )
      expect(fetchMock.mock.calls[1][1]?.method).toBe('POST')
      expect(bodyOf(1)).toEqual({ media_ids: ids(50, 101) })

      expect(result).toEqual({
        albums: [
          { id: 'a1', mediaIds: ['1', '2', '101'] },
          { id: 'a2', mediaIds: ['3'] },
          { id: 'a3', mediaIds: ['102'] }
        ]
      })
    })

    it('makes no request for empty array', async () => {
      const result = await getGalleryAlbumMembership([])

      expect(fetchMock).not.toHaveBeenCalled()
      expect(result).toEqual({ albums: [] })
    })

    it('throws on non-OK response', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Boom' }), {
        status: 500
      })

      await expect(getGalleryAlbumMembership(['1'])).rejects.toThrow('Boom')
    })
  })
})
