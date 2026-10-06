import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getActorCollections,
  isCollectionPageUrl,
  parseTotalItems
} from '@/lib/activities/getActorCollections'
import { ACTIVITY_JSON_HEADERS } from '@/lib/stub/activities'
import { Actor } from '@/lib/types/activitypub'
import { request } from '@/lib/utils/request'

vi.mock('@/lib/utils/request', () => ({ request: vi.fn() }))

describe('parseTotalItems', () => {
  it('returns null for undefined, null, and non-number types', () => {
    expect(parseTotalItems(undefined)).toBeNull()
    expect(parseTotalItems(null)).toBeNull()
    expect(parseTotalItems('10')).toBeNull()
    expect(parseTotalItems({})).toBeNull()
    expect(parseTotalItems([])).toBeNull()
    expect(parseTotalItems(true)).toBeNull()
  })

  it('returns null for negative numbers and non-finite values', () => {
    expect(parseTotalItems(-1)).toBeNull()
    expect(parseTotalItems(-0.5)).toBeNull()
    expect(parseTotalItems(Number.NaN)).toBeNull()
    expect(parseTotalItems(Number.POSITIVE_INFINITY)).toBeNull()
    expect(parseTotalItems(Number.NEGATIVE_INFINITY)).toBeNull()
  })

  it('returns non-negative integers', () => {
    expect(parseTotalItems(0)).toBe(0)
    expect(parseTotalItems(42)).toBe(42)
    expect(parseTotalItems(10.8)).toBe(10)
  })
})

describe('isCollectionPageUrl', () => {
  it('returns true when page url matches collection url exactly', () => {
    expect(
      isCollectionPageUrl(
        'https://example.com/users/alice/followers',
        'https://example.com/users/alice/followers'
      )
    ).toBe(true)
  })

  it('returns true when page url is subpath of collection url', () => {
    expect(
      isCollectionPageUrl(
        'https://example.com/users/alice/followers/page/1',
        'https://example.com/users/alice/followers'
      )
    ).toBe(true)
  })

  it('returns false when host or protocol does not match', () => {
    expect(
      isCollectionPageUrl(
        'https://other.com/users/alice/followers',
        'https://example.com/users/alice/followers'
      )
    ).toBe(false)
  })
})

describe('getActorCollections context inheritance', () => {
  const mockRequest = vi.mocked(request)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('carries root collection context into inline collection page', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          { rootTerm: 'https://example.com/ns#root' }
        ],
        id: 'https://example.com/outbox',
        type: 'OrderedCollection',
        totalItems: 1,
        orderedItems: ['https://example.com/status/1']
      })
    })

    const person = {
      id: 'https://example.com/user',
      outbox: 'https://example.com/outbox'
    } as Actor
    const result = await getActorCollections({ person, field: 'outbox' })
    expect(result?.page?.['@context']).toEqual([
      'https://www.w3.org/ns/activitystreams',
      { rootTerm: 'https://example.com/ns#root' }
    ])
    expect(result?.totalItems).toBe(1)
  })

  it('reads a root inlining a single bare orderedItems value as a one-item page', async () => {
    const item = { id: 'https://example.com/status/1', type: 'Note' }
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://example.com/outbox',
        type: 'OrderedCollection',
        orderedItems: item
      })
    })

    const person = {
      id: 'https://example.com/user',
      outbox: 'https://example.com/outbox'
    } as Actor
    const result = await getActorCollections({ person, field: 'outbox' })
    expect(result?.page?.orderedItems).toEqual([item])
    expect(result?.totalItems).toBe(1)
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })

  it('carries root collection context into fetched page when page omits @context', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        '@context': [
          'https://www.w3.org/ns/activitystreams',
          { rootTerm: 'https://example.com/ns#root' }
        ],
        id: 'https://example.com/outbox',
        type: 'OrderedCollection',
        totalItems: 42,
        first: 'https://example.com/outbox/page/1'
      })
    })
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        id: 'https://example.com/outbox/page/1',
        type: 'OrderedCollectionPage',
        partOf: 'https://example.com/outbox',
        next: 'https://example.com/outbox/page/2',
        prev: 'https://example.com/outbox/page/0',
        totalItems: 42,
        orderedItems: ['https://example.com/status/1']
      })
    })

    const person = {
      id: 'https://example.com/user',
      outbox: 'https://example.com/outbox'
    } as Actor
    const result = await getActorCollections({ person, field: 'outbox' })
    expect(result?.page?.['@context']).toEqual([
      'https://www.w3.org/ns/activitystreams',
      { rootTerm: 'https://example.com/ns#root' }
    ])
    expect(result?.totalItems).toBe(42)
    expect(result?.page?.next).toBe('https://example.com/outbox/page/2')
    expect(result?.page?.prev).toBe('https://example.com/outbox/page/0')
  })

  it('combines root and page contexts with root definitions preceding page definitions', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        '@context': { rootTerm: 'https://example.com/ns#root' },
        id: 'https://example.com/outbox',
        type: 'OrderedCollection',
        first: 'https://example.com/outbox/page/1'
      })
    })
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        '@context': { pageTerm: 'https://example.com/ns#page' },
        id: 'https://example.com/outbox/page/1',
        type: 'OrderedCollectionPage',
        orderedItems: []
      })
    })

    const person = {
      id: 'https://example.com/user',
      outbox: 'https://example.com/outbox'
    } as Actor
    const result = await getActorCollections({ person, field: 'outbox' })
    expect(result?.page?.['@context']).toEqual([
      { rootTerm: 'https://example.com/ns#root' },
      { pageTerm: 'https://example.com/ns#page' }
    ])
  })

  it('resets context inheritance when fetched page specifies @context: null', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        '@context': { rootTerm: 'https://example.com/ns#root' },
        id: 'https://example.com/outbox',
        type: 'OrderedCollection',
        first: 'https://example.com/outbox/page/1'
      })
    })
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        '@context': null,
        id: 'https://example.com/outbox/page/1',
        type: 'OrderedCollectionPage',
        orderedItems: []
      })
    })

    const person = {
      id: 'https://example.com/user',
      outbox: 'https://example.com/outbox'
    } as Actor
    const result = await getActorCollections({ person, field: 'outbox' })
    expect(result?.page?.['@context']).toBeNull()
  })
})

describe('getActorCollections caller-supplied page', () => {
  const mockRequest = vi.mocked(request)
  const person = {
    id: 'https://example.com/users/hidden',
    followers: 'https://example.com/users/hidden/followers'
  } as Actor
  const guessedPage = 'https://example.com/users/hidden/followers?page=1'

  beforeEach(() => {
    // mockReset, not clearAllMocks: the first test deliberately leaves its
    // page response queued, and clearAllMocks keeps queued Once values.
    mockRequest.mockReset()
  })

  it('does not fetch a guessed page of a collection that advertises none', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: person.followers,
        type: 'OrderedCollection',
        totalItems: 12
      })
    })
    // Would be served if the guessed page were requested.
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        id: guessedPage,
        type: 'OrderedCollectionPage',
        orderedItems: ['https://example.com/users/secret-follower']
      })
    })

    const result = await getActorCollections({
      person,
      field: 'followers',
      pageUrl: guessedPage
    })

    expect(result).toEqual({ page: null, totalItems: 12 })
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })

  it('still follows a caller page when the collection advertises its first page', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: person.followers,
        type: 'OrderedCollection',
        totalItems: 12,
        first: `${person.followers}?page=0`
      })
    })
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: JSON.stringify({
        id: guessedPage,
        type: 'OrderedCollectionPage',
        orderedItems: ['https://example.com/users/follower']
      })
    })

    const result = await getActorCollections({
      person,
      field: 'followers',
      pageUrl: guessedPage
    })

    expect(mockRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: guessedPage })
    )
    expect(result?.page?.orderedItems).toEqual([
      'https://example.com/users/follower'
    ])
  })
})

describe('getActorCollections content type gate', () => {
  const mockRequest = vi.mocked(request)
  const person = {
    id: 'https://example.com/users/alice',
    followers: 'https://example.com/users/alice/followers'
  } as Actor
  const firstPage = `${person.followers}?page=1`
  const rootBody = JSON.stringify({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: person.followers,
    type: 'OrderedCollection',
    totalItems: 3,
    first: firstPage
  })
  const pageBody = JSON.stringify({
    id: firstPage,
    type: 'OrderedCollectionPage',
    orderedItems: ['https://example.com/users/follower']
  })
  const wrongTypes = [
    'application/json',
    'application/octet-stream',
    'text/plain'
  ]

  beforeEach(() => {
    mockRequest.mockReset()
  })

  // Bracketed by the same bodies served with ACTIVITY_JSON_HEADERS in
  // 'still follows a caller page when the collection advertises its first
  // page' above, and by the control assertions here.
  it('reads the root and the page when both are labelled ActivityPub', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: rootBody
    })
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: ACTIVITY_JSON_HEADERS,
      body: pageBody
    })

    const result = await getActorCollections({ person, field: 'followers' })

    expect(result?.totalItems).toBe(3)
    expect(result?.page?.orderedItems).toEqual([
      'https://example.com/users/follower'
    ])
  })

  it.each(wrongTypes)(
    'refuses a collection root served as %s',
    async (contentType) => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': contentType },
        body: rootBody
      })

      const result = await getActorCollections({ person, field: 'followers' })

      expect(result).toBeNull()
      expect(mockRequest).toHaveBeenCalledTimes(1)
    }
  )

  it.each(wrongTypes)(
    'drops a collection page served as %s but keeps the root total',
    async (contentType) => {
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: ACTIVITY_JSON_HEADERS,
        body: rootBody
      })
      mockRequest.mockResolvedValueOnce({
        statusCode: 200,
        headers: { 'content-type': contentType },
        body: pageBody
      })

      const result = await getActorCollections({ person, field: 'followers' })

      expect(mockRequest).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ page: null, totalItems: 3 })
    }
  )
})
