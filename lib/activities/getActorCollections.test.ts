import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getActorCollections,
  isCollectionPageUrl,
  parseTotalItems
} from '@/lib/activities/getActorCollections'
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
      headers: {},
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

  it('carries root collection context into fetched page when page omits @context', async () => {
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: {},
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
      headers: {},
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
      headers: {},
      body: JSON.stringify({
        '@context': { rootTerm: 'https://example.com/ns#root' },
        id: 'https://example.com/outbox',
        type: 'OrderedCollection',
        first: 'https://example.com/outbox/page/1'
      })
    })
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: {},
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
      headers: {},
      body: JSON.stringify({
        '@context': { rootTerm: 'https://example.com/ns#root' },
        id: 'https://example.com/outbox',
        type: 'OrderedCollection',
        first: 'https://example.com/outbox/page/1'
      })
    })
    mockRequest.mockResolvedValueOnce({
      statusCode: 200,
      headers: {},
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
