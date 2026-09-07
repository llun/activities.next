import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { Timeline } from '@/lib/services/timelines/types'

import {
  getCollectionFeed,
  getCollectionTimeline,
  getHashtagTimeline,
  getListTimeline,
  getTimeline
} from './timelines'

enableFetchMocks()

describe('client timelines module', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { origin: 'https://llun.test' }
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window')
  })

  describe('getTimeline', () => {
    it('fetches timeline with format activities_next and pagination', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-1' }],
          nextMaxStatusId: 'next-1',
          prevMinStatusId: 'prev-1'
        }),
        { status: 200 }
      )

      const res = await getTimeline({
        timeline: Timeline.HOME,
        limit: 20,
        maxStatusId: 'max-1',
        minStatusId: 'min-1'
      })

      expect(res).toEqual({
        statuses: [{ id: 'status-1' }],
        nextMaxStatusId: 'next-1',
        prevMinStatusId: 'prev-1'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://llun.test/api/v1/timelines/home?format=activities_next&min_id=min-1&max_id=max-1&limit=20',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('continues fetching when statuses array is empty and nextMaxStatusId exists', async () => {
      fetchMock
        .mockResponseOnce(
          JSON.stringify({
            statuses: [],
            nextMaxStatusId: 'cont-1',
            prevMinStatusId: null
          }),
          { status: 200 }
        )
        .mockResponseOnce(
          JSON.stringify({
            statuses: [{ id: 'status-cont' }],
            nextMaxStatusId: 'cont-2',
            prevMinStatusId: null
          }),
          { status: 200 }
        )

      const res = await getTimeline({ timeline: Timeline.HOME })
      expect(res.statuses).toHaveLength(1)
      expect(res.statuses[0].id).toBe('status-cont')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('returns empty result when status is not 200', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      const res = await getTimeline({ timeline: Timeline.HOME })
      expect(res).toEqual({
        statuses: [],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })
    })
  })

  describe('getHashtagTimeline', () => {
    it('fetches hashtag timeline with format activities_next', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-tag' }],
          nextMaxStatusId: 'next-tag'
        }),
        { status: 200 }
      )

      const res = await getHashtagTimeline({
        tag: 'running',
        maxStatusId: 'max-tag'
      })

      expect(res).toEqual({
        statuses: [{ id: 'status-tag' }],
        nextMaxStatusId: 'next-tag'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://llun.test/api/v1/tags/running?format=activities_next&max_id=max-tag',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty result when response is not 200', async () => {
      fetchMock.mockResponseOnce('', { status: 404 })

      const res = await getHashtagTimeline({ tag: 'missing' })
      expect(res).toEqual({
        statuses: [],
        nextMaxStatusId: null
      })
    })
  })

  describe('getListTimeline', () => {
    it('fetches list timeline with encoded id', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-list' }],
          nextMaxStatusId: 'next-list',
          prevMinStatusId: 'prev-list'
        }),
        { status: 200 }
      )

      const res = await getListTimeline({
        listId: 'list-123',
        limit: 10,
        maxStatusId: 'max-l',
        minStatusId: 'min-l'
      })

      expect(res).toEqual({
        statuses: [{ id: 'status-list' }],
        nextMaxStatusId: 'next-list',
        prevMinStatusId: 'prev-list'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://llun.test/api/v1/timelines/list/list-123?format=activities_next&min_id=min-l&max_id=max-l&limit=10',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty result on non-200 response', async () => {
      fetchMock.mockResponseOnce('', { status: 404 })

      const res = await getListTimeline({ listId: 'bad-list' })
      expect(res).toEqual({
        statuses: [],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })
    })
  })

  describe('getCollectionTimeline', () => {
    it('fetches collection timeline with encoded id', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-col' }],
          nextMaxStatusId: 'next-c',
          prevMinStatusId: 'prev-c'
        }),
        { status: 200 }
      )

      const res = await getCollectionTimeline({
        collectionId: 'col-123',
        limit: 5
      })

      expect(res).toEqual({
        statuses: [{ id: 'status-col' }],
        nextMaxStatusId: 'next-c',
        prevMinStatusId: 'prev-c'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://llun.test/api/v1/timelines/collection/col-123?format=activities_next&limit=5',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty result on non-200 response', async () => {
      fetchMock.mockResponseOnce('', { status: 500 })

      const res = await getCollectionTimeline({ collectionId: 'err-col' })
      expect(res).toEqual({
        statuses: [],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })
    })
  })

  describe('getCollectionFeed', () => {
    it('fetches public collection feed with encoded id', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-feed' }],
          nextMaxStatusId: 'next-f',
          prevMinStatusId: 'prev-f'
        }),
        { status: 200 }
      )

      const res = await getCollectionFeed({
        collectionId: 'col-456'
      })

      expect(res).toEqual({
        statuses: [{ id: 'status-feed' }],
        nextMaxStatusId: 'next-f',
        prevMinStatusId: 'prev-f'
      })
      expect(fetchMock).toHaveBeenCalledWith(
        'https://llun.test/api/v1/collections/col-456/feed?format=activities_next',
        expect.objectContaining({
          method: 'GET',
          headers: { Accept: 'application/json' }
        })
      )
    })

    it('returns empty result on non-200 response', async () => {
      fetchMock.mockResponseOnce('', { status: 404 })

      const res = await getCollectionFeed({ collectionId: 'err-feed' })
      expect(res).toEqual({
        statuses: [],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })
    })
  })
})
