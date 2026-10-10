import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  getGalleryLifeList,
  getGalleryMap,
  getGalleryMedia,
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
        limit: 30,
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
        limit: '30',
        subject: 'sci:alcedo atthis',
        category: 'bird',
        gear_id: 'gear-1',
        show: 'hidden'
      })
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
})
