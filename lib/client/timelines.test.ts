import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { Timeline } from '@/lib/services/timelines/types'
import { generatePublicId } from '@/lib/utils/publicId'

import {
  TimelineRequestError,
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

    it('fetches timeline with includeContext returning context payload', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-1' }],
          context: {
            ancestorsById: {
              'parent-1': {
                id: 'parent-1',
                actor: {
                  id: 'actor-1',
                  username: 'alice',
                  domain: 'example.com'
                },
                contentHtml: '<p>Parent</p>',
                createdAt: '2026-09-15T10:00:00.000Z',
                visibility: 'public'
              }
            }
          },
          nextMaxStatusId: 'next-1',
          prevMinStatusId: 'prev-1'
        }),
        { status: 200 }
      )

      const res = await getTimeline({
        timeline: Timeline.HOME,
        includeContext: true
      })

      expect(res.statuses).toEqual([{ id: 'status-1' }])
      expect(res.context?.ancestorsById['parent-1']).toBeDefined()
      expect(res.context?.ancestorsById['parent-1'].contentHtml).toBe(
        '<p>Parent</p>'
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

    it('throws TimelineRequestError on non-200 responses with status and unauthorized flag', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Session expired' }), {
        status: 401
      })

      await expect(getTimeline({ timeline: Timeline.HOME })).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(TimelineRequestError)
          const err = error as TimelineRequestError
          expect(err.message).toBe('Session expired')
          expect(err.status).toBe(401)
          expect(err.isUnauthorized).toBe(true)
          return true
        }
      )

      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Access denied' }), {
        status: 403
      })

      await expect(getTimeline({ timeline: Timeline.HOME })).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(TimelineRequestError)
          const err = error as TimelineRequestError
          expect(err.status).toBe(403)
          expect(err.isUnauthorized).toBe(true)
          return true
        }
      )

      fetchMock.mockResponseOnce('Internal server error', { status: 500 })

      await expect(getTimeline({ timeline: Timeline.HOME })).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(TimelineRequestError)
          const err = error as TimelineRequestError
          expect(err.status).toBe(500)
          expect(err.isUnauthorized).toBe(false)
          return true
        }
      )
    })

    it('throws TimelineRequestError on network failures', async () => {
      fetchMock.mockRejectOnce(new Error('Network offline'))

      await expect(getTimeline({ timeline: Timeline.HOME })).rejects.toSatisfy(
        (error: unknown) => {
          expect(error).toBeInstanceOf(TimelineRequestError)
          const err = error as TimelineRequestError
          expect(err.message).toBe('Network offline')
          expect(err.status).toBeUndefined()
          expect(err.isUnauthorized).toBe(false)
          return true
        }
      )
    })

    it('returns empty result when 200 OK has empty statuses', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [],
          nextMaxStatusId: null,
          prevMinStatusId: null
        }),
        { status: 200 }
      )

      const res = await getTimeline({ timeline: Timeline.HOME })
      expect(res).toEqual({
        statuses: [],
        nextMaxStatusId: null,
        prevMinStatusId: null
      })
    })

    it('forwards signal to fetch', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-1' }],
          nextMaxStatusId: null,
          prevMinStatusId: null
        }),
        { status: 200 }
      )

      const controller = new AbortController()
      await getTimeline({ timeline: Timeline.HOME, signal: controller.signal })

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/timelines/home'),
        expect.objectContaining({ signal: controller.signal })
      )
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

    it('forwards signal to fetch', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-tag' }],
          nextMaxStatusId: null
        }),
        { status: 200 }
      )

      const controller = new AbortController()
      await getHashtagTimeline({ tag: 'tech', signal: controller.signal })

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/tags/tech'),
        expect.objectContaining({ signal: controller.signal })
      )
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

    it('forwards signal to fetch', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          statuses: [{ id: 'status-list' }],
          nextMaxStatusId: null,
          prevMinStatusId: null
        }),
        { status: 200 }
      )

      const controller = new AbortController()
      await getListTimeline({ listId: 'list-1', signal: controller.signal })

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/timelines/list/list-1'),
        expect.objectContaining({ signal: controller.signal })
      )
    })
  })

  // Cursors travel in a query param, where the accept side (decodeCursor →
  // safeIdToUrl, or the publicId fast path) takes every client-facing id form
  // verbatim. Re-encoding here would turn a publicId cursor into `<uuid>:`,
  // which resolves to nothing and silently ends pagination.
  it.each([
    {
      description: 'a raw ActivityPub URI',
      maxStatusId: 'https://remote.example/users/a/statuses/older',
      minStatusId: 'https://remote.example/users/a/statuses/newer'
    },
    {
      description: 'a UUIDv7 public id',
      maxStatusId: generatePublicId(),
      minStatusId: generatePublicId()
    },
    {
      description: 'a legacy colon-form id',
      maxStatusId: 'remote.example:users:a:statuses:older',
      minStatusId: 'remote.example:users:a:statuses:newer'
    }
  ])(
    'sends $description cursor unchanged for the list timeline helper',
    async ({ maxStatusId, minStatusId }) => {
      fetchMock.mockResponse(
        JSON.stringify({
          statuses: [],
          nextMaxStatusId: null,
          prevMinStatusId: null
        }),
        { status: 200 }
      )

      // Parse the requested URL so the assertion is decoding-agnostic (`:` and
      // `/` are percent-escaped in the query string) and order-agnostic.
      const lastRequestUrl = () =>
        new URL(
          fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string
        )

      await getListTimeline({ listId: 'l1', maxStatusId, minStatusId })
      const timelineUrl = lastRequestUrl()
      expect(timelineUrl.pathname).toBe('/api/v1/timelines/list/l1')
      expect(timelineUrl.searchParams.get('max_id')).toBe(maxStatusId)
      expect(timelineUrl.searchParams.get('min_id')).toBe(minStatusId)
    }
  )
})
