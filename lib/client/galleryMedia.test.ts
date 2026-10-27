import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  addMediaToGallery,
  countGalleryMedia,
  getGalleryLifeList,
  getGalleryMap,
  getGalleryMedia,
  getGalleryMediaFacets,
  getGalleryMediaIds,
  getGallerySubjects
} from './galleryMedia'

enableFetchMocks()

const ACTOR_ID = 'https://llun.test/users/test1'
const SEGMENT = 'llun.test:users:test1'
const READ_INIT = { method: 'GET', headers: { Accept: 'application/json' } }

describe('gallery media client module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  describe('getGalleryMedia', () => {
    it('requests the page with no query by default', async () => {
      const page = { items: [], nextMaxId: null }
      fetchMock.mockResponseOnce(JSON.stringify(page))

      expect(await getGalleryMedia(ACTOR_ID)).toEqual(page)
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/accounts/${SEGMENT}/gallery/media`,
        READ_INIT
      )
    })

    it('sends every option, the subject key verbatim', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ items: [], nextMaxId: null }))

      await getGalleryMedia(ACTOR_ID, {
        maxId: '42',
        limit: 24,
        subject: 'sci:alcedo atthis',
        category: 'bird',
        gearId: 'gear-1',
        show: 'hidden'
      })

      const url = new URL(
        fetchMock.mock.calls[0][0] as string,
        'https://x.test'
      )
      expect(url.pathname).toBe(`/api/v1/accounts/${SEGMENT}/gallery/media`)
      expect(Object.fromEntries(url.searchParams)).toEqual({
        max_id: '42',
        limit: '24',
        subject: 'sci:alcedo atthis',
        category: 'bird',
        gear_id: 'gear-1',
        show: 'hidden'
      })
    })

    it('sends the filter, sort and cursor options', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ items: [], nextMaxId: null }))

      await getGalleryMedia(ACTOR_ID, {
        cursor: '1700000000000:7',
        sort: 'taken_asc',
        place: 'none',
        takenFrom: '2026-01-01',
        takenTo: '2026-01-31',
        activityId: 'file-1',
        albumId: 'album-1',
        includeTotal: true
      })

      const url = new URL(
        fetchMock.mock.calls[0][0] as string,
        'https://x.test'
      )
      expect(Object.fromEntries(url.searchParams)).toEqual({
        cursor: '1700000000000:7',
        sort: 'taken_asc',
        place: 'none',
        taken_from: '2026-01-01',
        taken_to: '2026-01-31',
        activity_id: 'file-1',
        album_id: 'album-1',
        include_total: 'true'
      })
    })

    it('leaves include_total off unless asked', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ items: [], nextMaxId: null }))

      await getGalleryMedia(ACTOR_ID, { includeTotal: false })

      expect(fetchMock.mock.calls[0][0] as string).not.toContain(
        'include_total'
      )
    })

    it('sends include_days only when asked', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ items: [], nextMaxId: null }))

      await getGalleryMedia(ACTOR_ID, { includeDays: true })

      const withDays = new URL(
        fetchMock.mock.calls[0][0] as string,
        'https://x.test'
      )
      expect(withDays.searchParams.get('include_days')).toBe('true')

      fetchMock.mockResponseOnce(JSON.stringify({ items: [], nextMaxId: null }))

      await getGalleryMedia(ACTOR_ID, { includeDays: false })

      expect(fetchMock.mock.calls[1][0] as string).not.toContain('include_days')
    })

    it('sends a day key and forwards an AbortSignal', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ items: [], nextMaxId: null }))
      const signal = new AbortController().signal

      await getGalleryMedia(ACTOR_ID, {
        sort: 'uploaded',
        dayKey: 'uploaded:2025-10-04',
        signal
      })

      const url = new URL(
        fetchMock.mock.calls[0][0] as string,
        'https://x.test'
      )
      expect(url.searchParams.get('day_key')).toBe('uploaded:2025-10-04')
      expect(fetchMock.mock.calls[0][1]).toEqual({ ...READ_INIT, signal })
    })

    it('throws the API error message', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'gear_id is only available to the owner' }),
        { status: 422 }
      )

      await expect(getGalleryMedia(ACTOR_ID, { gearId: 'g' })).rejects.toThrow(
        'gear_id is only available to the owner'
      )
    })
  })

  describe('countGalleryMedia', () => {
    it('asks for one item and returns the total', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ items: [], nextMaxId: null, total: 12 })
      )

      expect(await countGalleryMedia(ACTOR_ID, { place: 'Paris' })).toBe(12)

      const url = new URL(
        fetchMock.mock.calls[0][0] as string,
        'https://x.test'
      )
      expect(Object.fromEntries(url.searchParams)).toEqual({
        limit: '1',
        include_total: 'true',
        place: 'Paris'
      })
    })

    it('is zero when the answer has no total', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ items: [], nextMaxId: null }))

      expect(await countGalleryMedia(ACTOR_ID, {})).toBe(0)
    })
  })

  describe('getGalleryMediaIds', () => {
    it('sends ids_only, the day key, the limit and every filter', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ mediaIds: ['9', '8', '7'] }))

      expect(
        await getGalleryMediaIds(ACTOR_ID, {
          dayKey: 'uploaded:2025-10-04',
          limit: 2000,
          offset: 2000,
          subject: 'sci:alcedo atthis',
          category: 'bird',
          gearId: 'gear-1',
          show: 'all',
          sort: 'uploaded',
          place: 'none',
          takenFrom: '2025-10-04',
          takenTo: '2025-10-04',
          activityId: 'file-1',
          albumId: 'album-1'
        })
      ).toEqual(['9', '8', '7'])

      const url = new URL(
        fetchMock.mock.calls[0][0] as string,
        'https://x.test'
      )
      expect(url.pathname).toBe(`/api/v1/accounts/${SEGMENT}/gallery/media`)
      expect(Object.fromEntries(url.searchParams)).toEqual({
        ids_only: 'true',
        day_key: 'uploaded:2025-10-04',
        limit: '2000',
        offset: '2000',
        subject: 'sci:alcedo atthis',
        category: 'bird',
        gear_id: 'gear-1',
        show: 'all',
        sort: 'uploaded',
        place: 'none',
        taken_from: '2025-10-04',
        taken_to: '2025-10-04',
        activity_id: 'file-1',
        album_id: 'album-1'
      })
    })

    it('leaves the optional filters off', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ mediaIds: [] }))

      expect(
        await getGalleryMediaIds(ACTOR_ID, {
          dayKey: '2025-10-04',
          limit: 40
        })
      ).toEqual([])

      const url = new URL(
        fetchMock.mock.calls[0][0] as string,
        'https://x.test'
      )
      expect(Object.fromEntries(url.searchParams)).toEqual({
        ids_only: 'true',
        day_key: '2025-10-04',
        limit: '40'
      })
    })

    it('throws the API error message', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({ error: 'ids_only is only available to the owner' }),
        { status: 422 }
      )

      await expect(
        getGalleryMediaIds(ACTOR_ID, { dayKey: '2025-10-04', limit: 40 })
      ).rejects.toThrow('ids_only is only available to the owner')
    })
  })

  describe('getGalleryMediaFacets', () => {
    it.each([
      [undefined, '/api/v1/gallery/media/facets'],
      ['hidden' as const, '/api/v1/gallery/media/facets?show=hidden']
    ])('requests show=%s', async (show, url) => {
      const body = { total: 0 }
      fetchMock.mockResponseOnce(JSON.stringify(body))

      expect(await getGalleryMediaFacets({ show })).toEqual(body)
      expect(fetchMock).toHaveBeenCalledWith(url, READ_INIT)
    })

    it('defaults to no options', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ total: 0 }))

      await getGalleryMediaFacets()

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/gallery/media/facets',
        READ_INIT
      )
    })
  })

  describe('getGallerySubjects', () => {
    it('returns the grouped subjects', async () => {
      const body = { groups: [], unidentifiedCount: 0, truncated: false }
      fetchMock.mockResponseOnce(JSON.stringify(body))

      expect(await getGallerySubjects(ACTOR_ID)).toEqual(body)
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/accounts/${SEGMENT}/gallery/subjects`,
        READ_INIT
      )
    })

    it('throws on failure', async () => {
      fetchMock.mockResponseOnce('{}', { status: 500 })

      await expect(getGallerySubjects(ACTOR_ID)).rejects.toThrow()
    })
  })

  describe.each([
    ['getGalleryLifeList', () => getGalleryLifeList(ACTOR_ID), 'life-list'],
    ['getGalleryMap', () => getGalleryMap(ACTOR_ID), 'map']
  ])('%s', (_, run, segment) => {
    it('returns the body', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ truncated: false }))

      expect(await run()).toEqual({ truncated: false })
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/accounts/${SEGMENT}/gallery/${segment}`,
        READ_INIT
      )
    })

    it('returns null on 404, which means it is not public', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not Found' }), {
        status: 404
      })

      expect(await run()).toBeNull()
    })

    it('throws on any other failure', async () => {
      fetchMock.mockResponseOnce('{}', { status: 500 })

      await expect(run()).rejects.toThrow()
    })
  })

  it('getGalleryMap asks for the public preview when told to', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ points: [], truncated: false }))

    await getGalleryMap(ACTOR_ID, { previewPublic: true })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/accounts/${SEGMENT}/gallery/map?preview=public`,
      READ_INIT
    )
  })

  it('passes an already-encoded actor id through unchanged', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ groups: [] }))

    await getGallerySubjects(SEGMENT)

    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/v1/accounts/${SEGMENT}/gallery/subjects`
    )
  })
  describe('addMediaToGallery', () => {
    it('posts the media ids and resolves to the ones added', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ media_ids: ['9', '8'] }))

      expect(await addMediaToGallery(['8', '9', 'gone'])).toEqual(['9', '8'])

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/gallery/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_ids: ['8', '9', 'gone'] })
      })
    })

    it('rejects with the server message when none could be added', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Not found' }), {
        status: 404
      })

      await expect(addMediaToGallery(['1'])).rejects.toThrow('Not found')
    })

    it('falls back to a generic message', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      await expect(addMediaToGallery(['1'])).rejects.toThrow(
        'Failed to add to your gallery.'
      )
    })
  })
})
